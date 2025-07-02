# Create Free Pinecone Vector Database

Create a free vector pinecone database here `https://www.pinecone.io/`. They
offer a generous free tier that's perfect for our application.

![Free tier](https://d14x58xoxfhz1s.cloudfront.net/a725be13-6227-4d92-a6a1-3aaa936b54a2)

Create a project and then create a Serverless index within that project.

![Create Index](https://d14x58xoxfhz1s.cloudfront.net/b681e132-c458-44e4-9ad7-ca49817477e2)

![Create Index 2](https://d14x58xoxfhz1s.cloudfront.net/adb76426-efbc-4bde-a3eb-edf88ac9d804)

Once created, copy the host link and paste somewhere. We'll be needing it later.

![host link](https://d14x58xoxfhz1s.cloudfront.net/3e7f21e4-b692-4a25-b8e3-e807b012d39d)

Also navigate to the `API KEY` menu on the left and create a new API KEY. We'll
add this `API KEY` to `AWS SECRETS MANAGER` and use it alongside the host url to
access the pinecone index.

![api key menu](https://d14x58xoxfhz1s.cloudfront.net/9170a315-d787-48fe-aae2-0b7808d2495a)

![api key](https://d14x58xoxfhz1s.cloudfront.net/f6ca4177-6c5c-4e3c-872e-a466a462f829)
