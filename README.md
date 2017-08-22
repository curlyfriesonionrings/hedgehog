# hedgehog
Facebook Messenger bot written in node.js for receipt management. Prototype code that is not live any more.

<p float="left">
  <img src="/screen1.png" width="32%" />
  <img src="/screen2.png" width="32%" /> 
  <img src="/screen3.png" width="32%" />
</p>

A Facebook Messenger bot was created and associated with a Facebook page. The bot accepted images of store receipts and put it through a processing pipeline (see <a href="https://github.com/curlyfriesonionrings/hedgehog/blob/master/logic.png">logic.png</a> for pipeline).

When HedgeHog received an image, the data is sent to Google Vision's API with an OCR request. The data is received and sent to RestDB.io, where a NoSQL database stores the response from Google Vision's API. Users can then interface with the bot using primitive commands (in the form of "command [argument]") to:
* See the OCR response for a particular receipt
* See what receipt data is associated with the user's account
* Search the entire NoSQL data store for a keyword.

Microsoft Azure OCR was considered, but after testing, Google Vision OCR returned more accurate results. ElasticSearch was used for searching.

The goal of the project was to create an aggregated source of receipt data collected from users and allow users to search the data for their benefit. Some example use cases would be:
* Find where to purchase a particular item for cheaper
* Find where to purchase a particular item at or around a given time period (by looking through previous purchase datetimes)

Additional potential value propositions included:
* Being able to track spending in particular categories for users or notice spending patterns and offer promotions
* Suggest reminders (eg: user buys milk every week, but hasn't submitted a receipt with milk in the past week. Hedgehog could send a reminder that user might be low on milk; user buys perishable produce. Hedgehog can remind user of expiration dates).

The project was abandoned because the pre and post processing pipelines for optimal OCR results required advanced computer vision techniques.
