const express = require("express");
const cors = require("cors");
const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 9000;
const app = express();

const corsOptions = {
  origin: ['http://localhost:5173',/*'https://service-hero-c6742.web.app'*/],
  credentials: true,
  optionalSuccessStatus: 200,
}

app.use(cors(corsOptions))
app.use(express.json());
app.use(cookieParser())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.b4zor.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
// verifyToken
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token
  if (!token) return res.status(401).send({ message: 'unauthorized access' })
  jwt.verify(token, process.env.SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
  })
  next()
}

async function run() {
  try {
    const db = client.db("service-hero");
    const servicesCollection = db.collection("services");
    const bookingsCollection = db.collection("bookings");

    // jwt generate
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.SECRET_KEY, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })

    // Clear token on logout
    app.get('/logout', (req, res) => {
      res
        .clearCookie('token', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          maxAge: 0,
        })
        .send({ success: true })
    })

    // save a serviceData in db
    app.post("/add-service",verifyToken, async (req, res) => {
      const serviceData = req.body;
      const result = await servicesCollection.insertOne(serviceData);
      console.log(result);
      res.send(result);
    });
    // get all services data from db
    app.get("/services", async (req, res) => {
      const result = await servicesCollection
        .find()
        .limit(6)
        .toArray();
      res.send(result);
    });
    //    app.get("/allServices", async (req, res) => {
    //   const { search} = req.query;

    //   console.log(search);

    //   let option = {};

    //   if (search) {
    //     option = { title: { $regex: search, $options: "i" } };
    //   }
    //   const result = await servicesCollection.find(option).toArray();
    //   res.send(result);
    // });
    // // get all services posted by a specific user
    // app.get("/services/:email",verifyToken, async (req, res) => {
    //   const tokenEmail = req.user.email
    //   const email = req.params.email;
    //   if (tokenEmail !== email) {
    //     return res.status(403).send({ message: 'forbidden access' })
    //   }
    //   const query = { "serviceProvider.email": email };
    //   const result = await servicesCollection.find(query).toArray();
    //   res.send(result);
    // });
    // // delete a service data from db
    // app.delete("/service/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) };
    //   const result = await servicesCollection.deleteOne(query);
    //   res.send(result);
    // });
    // // get a single service data by id from db
    // app.get("/service/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) };
    //   const result = await servicesCollection.findOne(query);
    //   res.send(result);
    // });
    // // update a service in db
    // app.put("/update-service/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const serviceData = req.body;
    //   const query = { _id: new ObjectId(id) };
    //   const options = { upsert: true };
    //   const updateDoc = {
    //     $set: {
    //       ...serviceData,
    //     },
    //   };
    //   const result = await servicesCollection.updateOne(
    //     query,
    //     updateDoc,
    //     options
    //   );
    //   res.send(result);
    // });
    // // save a booking data in db
    // app.post("/add-booking", async (req, res) => {
    //   const bookingData = req.body;
    //   console.log("bookingData",bookingData);
    //   // 0. if a user placed a booking already in this service
    //   const query = { "user.email": bookingData?.user?.email, id: bookingData?.id };
    //   console.log("query", query);
    //   const exist = await bookingsCollection.findOne(query);
    //   console.log("If already exist-->", exist);
    //   if (exist)
    //     return res.status(400).send("You have already booked this service!");
    //   // 1. Save data in booking collection

    //   const result = await bookingsCollection.insertOne(bookingData);
    //   res.send(result);
    // });
    // app.get("/booking/:email",verifyToken, async (req, res) => {
    //   const tokenEmail = req.user?.email
    //   const email = req.params.email;
    //   // console.log('email from token-->', tokenEmail)
    //   // console.log('email from params-->', email)
    //   if (tokenEmail !== email) {
    //     return res.status(403).send({ message: 'forbidden access' })
    //   }
    //   const query = { "user.email": email };
    //   const result = await bookingsCollection.find(query).toArray();
    //   res.send(result);
    // });
    // app.get("/booking/service/:email",verifyToken, async (req, res) => {
    //    const tokenEmail = req.user?.email
    //   const email = req.params.email;
    //   if (tokenEmail !== email) {
    //     return res.status(403).send({ message: 'forbidden access' })
    //   }
    //   const query = { "providerEmail": email };
    //   const result = await bookingsCollection.find(query).toArray();
    //   res.send(result);
    // });
    // app.patch("/booking/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const data = req.body;
    //   const filter = { _id: new ObjectId(id) };
    //   const updatedDoc = {
    //     $set: {
    //       serviceStatus: data.serviceStatus,
    //     },
    //   };
    //   const result = await bookingsCollection.updateOne(filter, updatedDoc);
    //   res.send(result);
    // });
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Hostel Hero server....");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
