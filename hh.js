var restify = require('restify');
var server = restify.createServer();
var mongodb = require('mongodb').MongoClient;
var request = require('request');
var base64 = require('base64-js');
var prettyjson = require('prettyjson');
var elasticsearch = require('elasticsearch');
var esclient = new elasticsearch.Client({
  host: 'localhost:9200',
  log: 'trace'
});
server.use(restify.bodyParser());
server.use(restify.queryParser());

const PAGE_ACCESS_TOKEN = '<<PAGE_TOKEN_HERE>>';

function hellofb(req, res, next) {
        // Restify currently has a bug which doesn't allow you to set default headers
        // This headers comply with CORS and allow us to server our response to any origin
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "X-Requested-With");
        res.contentType = "text/plain";
    var VERIFY_TOKEN = '<<VERIFY_TOKEN_HERE';
        if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
          var challenge_response = req.query['hub.challenge'];
      res.send(challenge_response);
    } else {
          next(new restify.ForbiddenError("Could not verify your request " + req.query['hub.verify_token']));
    }
}


/**********************/
/** MESSAGE HANDLERS **/
/**********************/

function handleMessage(req, res, next) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        }
      });
    });

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've
    // successfully received the callback. Otherwise, the request will time out.
    res.send(200);
  }
}

function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:",
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s",
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);

    sendTextMessage(senderID, "Quick reply tapped");
    return;
  }

  if (messageText) {
    if (messageText.indexOf(' ') >= 0) {
      var cmd = messageText.split(' ')[0].toLowerCase();
      var arg = messageText.split(' ')[1];

      switch (cmd) {
        case 'view':
          processViewCommand(senderID, arg);
          break;

        case 'my':
          if (arg.toLowerCase() === 'files') {
            showMyReceipts(senderID);
          }
          break;

        case 'find':
        case 'search':
          searchReceipts(senderID, arg);
          break;

        default:
          sendTextMessage(senderID, messageText);
          break;
      }
          break;
      }
    }
    else if (messageText.toLowerCase() === "help") {
      displayCommandList(senderID);
    }
    else {
      sendTextMessage(senderID, messageText);
    }
  } else if (messageAttachments) {
    messageAttachments.forEach(function(attachment) {
      if (attachment.type === 'image') {
        sendTextMessage(senderID, "Please wait while the image is processed.");
        requestOCR(event, attachment.payload.url);
      }
      else {
        sendTextMessage(senderID, "Sorry, I can currently only handle image attachments.")
      }
    });
  }
}


function processViewCommand(senderID, arg) {
  // Query arg
  esclient.get({
    index: 'receipt',
    type: 'fbmessenger',
    id: arg
  }, function (err, res) {
    if (err) {
      console.log('Error: ', err);
      sendTextMessage(senderID, "Sorry, I couldn't find '" + arg + "' in my database.");
      return;
    }

    var ocrresp = res._source.googleocr.responses;
    ocrresp.forEach(function (resp) {
      for (var prop in resp) {
        if (prop === 'textAnnotations') {
          // Entire description is always first entry
          sendTextMessage(senderID, resp.textAnnotations[0].description);
        }
      }
    });
  });
}

function showMyReceipts(senderID) {
  const query = 'fbmessage.sender.id:' + senderID;

  esclient.search({
    index: 'receipt',
    q: query
  }, function (err, res) {
    if (err) {
      console.log('Error: ', err);
      sendTextMessage(senderID, 'Oops! There was a problem getting your files.');
      return;
    }

    var message = 'Found the following file IDs:';
    const hits = res.hits.hits;
    hits.forEach(function (resp) {
      message += '\n' + resp._id;
    });

    sendTextMessage(senderID, message);

    sendTextMessage(senderID, "To view a file, enter 'view [file ID]'");
  });
}

function searchReceipts(senderID, arg) {
  esclient.search({
    index: 'receipt',
    q: arg
  }, function (err, res) {
    if (err) {
      console.log('Error: ', err);
      sendTextMessage(senderID, 'Oops! There was a problem searching the file database.');
      return;
    }

    var message = "Found the term '" + arg + "' in following file IDs:";
    const hits = res.hits.hits;
    hits.forEach(function (resp) {
      message += '\n' + resp._id;
    });

    sendTextMessage(senderID, message);

    sendTextMessage(senderID, "To view a file, enter 'view [file ID]'");
  });
}

function displayCommandList(senderID) {
  const response = "Command List:\n  view [file ID]\n  my files\n  search [text]";

  sendTextMessage(senderID, response);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s",
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);
}

function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);

  // When a postback is called, we'll send a message back to the sender to
  // let them know it was successful
  sendTextMessage(senderID, "Postback called");
}

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;

  // All messages before watermark (a timestamp) or sequence have been seen.
  var watermark = event.read.watermark;
  var sequenceNumber = event.read.seq;

  console.log("Received message read event for watermark %d and sequence " +
    "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var status = event.account_linking.status;
  var authCode = event.account_linking.authorization_code;

  console.log("Received account link event with for user %d with status %s " +
    "and auth code %s ", senderID, status, authCode);
}

/*********************/
/**  SEND FUNCTIONS **/
/*********************/

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  // 320 utf-8 byte length cap per response message
  const textLen = Buffer.byteLength(messageText, 'utf8');
  var messages = [];
  if (textLen > 320) {
    const CHUNKSIZE = 319;
    var start = 0;
    while (Buffer.byteLength(messageText.substring(start), 'utf8') > 320) {
      var end = start + CHUNKSIZE;
      if (end < textLen) {
        messages.push(messageText.substring(start, end));
        start += CHUNKSIZE;
      }
      else {
        messages.push(messageText.substring(start));
      }
    }
  }
  else {
    messages.push(messageText);
  }

  messages.forEach(function(msg) {
    var messageData = {
      recipient: {
    var messageData = {
      recipient: {
        id: recipientId
      },
      message: {
        text: msg,
        metadata: "DEVELOPER_DEFINED_METADATA"
      }
    };

    callSendAPI(messageData);
  });
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s",
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s",
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });
}

/*
 * Builds OCR request to Google Vision API and inserts results into database
 *
 * Returns the _id of the record inserted into database
 */
function requestOCR(event, imgUrl) {
  const GOOGLE_API_KEY = '<<GOOGLE_API_KEY HERE>>';
  const URL = 'https://vision.googleapis.com/v1/images:annotate?key=' + GOOGLE_API_KEY;
  const MAX_RESULTS = 3;

  const senderID = event.sender.id;

  // Image URL cannot be extracted from event at this point because we lack the array index reference
  var imgOptions = { url: imgUrl, encoding: null };

  request.get(imgOptions, function (err, res, body) {
    const payload = {
      requests: [ {
        image: {
          content: base64.fromByteArray(body)
        },
        features: [
        {
          type: 'TEXT_DETECTION',
          maxResults: MAX_RESULTS
        } ]
      } ]
    }

    var options = {
      method: 'POST',
      body: payload,
      json: true,
      url: URL,
      headers: {'content-type': 'application/json'}
    }
	
    request(options, function (err, res, body) {
      if (err) {
        console.log('Error: ', err);
        sendTextMessage(senderID, 'Oops! There was an error processing the image. Please try again.');
        return;
      }
      // Build JSON object to insert into DB
      var insertData = {
        'fbmessage': event,
        'googleocr': body
      }

      esclient.index({
        index: 'receipt',
        type: 'fbmessenger',
        body: insertData
      }, function (err, res) {
        if (err) {
          console.log('Error: ', err);
          sendTextMessage(senderID, 'Oops! There was a problem saving the information. Please try again.');
          return;
        }

        const id = res._id;
        sendTextMessage(senderID, 'Added record with ID: ' + id);
        sendTextMessage(senderID, "To view the extracted text, please enter 'view " + id + "'.");
      });
    });
  });
}

// Set up our routes and start the server
server.get('/hello', hellofb);
server.post('/hello', handleMessage);
var port = process.env.PORT || 4378;

server.listen(port, function (err) {
    if (err)
        console.error(err)
    else
                mongodb.connect("mongodb://localhost:27017/exampleDb", function(err, db) {
                  if(!err) {
                    console.log("We are connected to exampleDb (MongoDb)");
                 }
                });
        console.log('App is ready at : ' + port)
})