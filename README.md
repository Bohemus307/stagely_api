# 🕵️‍♀️ The Great Image Detective API 🕵️‍♂️

Welcome to the most exciting thing to happen to images since the invention of the camera! Our Image Detective API is here to solve the age-old mystery: "What's different in these two pictures?" It's like playing "Spot the Difference," but with AI doing all the hard work while you sip your coffee.

## 🚀 Features

* Compare two images faster than you can say "Where's Waldo?"
* Detect added objects (Did someone sneak a rubber duck into the scene?)
* Spot removed objects (Where did that rubber duck go?)
* Identify changed objects (Did the rubber duck get a makeover?)

### 🛠 Prerequisites

Before you embark on this thrilling journey of image comparison, make sure you have:

* Node.js (v14 or later) installed on your machine
* An AWS account (Don't worry, Jeff Bezos won't personally come to your house)
* AWS CLI configured with your credentials
* A sense of humor (optional, but highly recommended)

#### 🎬 Getting Started

Clone this repository:

```bsh
  git clone https://github.com/your-username/image-detective-api.git
```

then...

```bsh
cd image-detective-api
```

* Install dependencies:

```bsh
npm install
```

(Watch as your computer downloads half the internet)!!!!

* And then set up your environment variables:

Create a .env file in the root directory and add the following:
CopyS3_BUCKET_NAME=your-bucket-name
AWS_REGION=your-preferred-region
Replace your-bucket-name with your actual S3 bucket name, and your-preferred-region with your AWS region (e.g., "us-west-2"). If you're feeling adventurous, try "us-west-2024" and see what happens! (Spoiler: It won't work)

* Start the server:

```bsh
  npm start
```

If everything goes well, you should see a message like "Server is running on <http://localhost:3000>". If not, well... did you remember to turn it on and off again?

##### 🎭 Using the API

To compare two images, send a POST request to /compare with the following JSON body:

```json
{
  "sourceImage": "path/to/source/image.jpg",
  "targetImage": "path/to/target/image.jpg"
}
```

Replace path/to/source/image.jpg and path/to/target/image.jpg with the actual paths of your images in the S3 bucket.

* Example using curl:

```bsh
curl -X POST http://localhost:3000/compare \
  -H "Content-Type: application/json" \
  -d '{"sourceImage":"before.jpg","targetImage":"after.jpg"}'
```

If successful, you'll get a response that looks something like this:

```bsh
jsonCopy{
  "addedObjects": [
    { "name": "Rubber Duck", "confidence": 99.9 }
  ],
  "removedObjects": [
    { "name": "Common Sense", "confidence": 0.1 }
  ],
  "changedObjects": [
    { "name": "Developer's Sanity", "confidence": 50.0 }
  ]
}
```

#### 🐛 Troubleshooting

If you get an error about missing environment variables, make sure your .env file is present and correct. If it's not there, the API will assume you're trying to store images in a bucket called 'NO_BUCKET_PROVIDED', which, surprisingly, AWS doesn't automatically create for you.
If AWS services are not working, check your AWS CLI configuration. Remember, "aws configure" is your friend, even if it feels like it's interrogating you.
If you're getting unexpected results, double-check that your images are actually different. We've had reports of developers staring at the same image for hours wondering why the API isn't detecting any changes.

#### 🎉 Contributing

Found a bug? Want to add a feature? Think you can make this README even funnier? We welcome contributions! Just fork the repo, make your changes, and submit a pull request. We promise to read it eventually.
📜 License
This project is licensed under the "Please Don't Use This For Evil" license. We're not sure if that's a real license, but it sounds good, doesn't it?

#### 🙏 Acknowledgements

Thanks to AWS for providing services that make us feel both powerful and confused at the same time.
Shoutout to all the rubber ducks out there. You know what you did.

Remember, with great power comes great responsibility. Use this API wisely, and may your image comparisons be ever in your favor! 🖼️✨