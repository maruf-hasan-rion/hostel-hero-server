const express = require("express");
const cors = require("cors");
// const jwt = require('jsonwebtoken')
// const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 9000;
const app = express();

const corsOptions = {
  origin: ['http://localhost:5173','http://localhost:5174'/*'https://service-hero-c6742.web.app'*/],
  credentials: true,
  optionalSuccessStatus: 200,
}

app.use(cors(corsOptions))
app.use(express.json());
// app.use(cookieParser())


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
// const verifyToken = (req, res, next) => {
//   const token = req.cookies?.token
//   if (!token) return res.status(401).send({ message: 'unauthorized access' })
//   jwt.verify(token, process.env.SECRET_KEY, (err, decoded) => {
//     if (err) {
//       return res.status(401).send({ message: 'unauthorized access' })
//     }
//     req.user = decoded
//   })
//   next()
// }

async function run() {
  try {
    const db = client.db("hostel-hero");
    const userCollection = db.collection("users");
    const mealsCollection = db.collection("meals");
    const bookingsCollection = db.collection("bookings");

    // // jwt generate
    // app.post('/jwt', async (req, res) => {
    //   const email = req.body
    //   const token = jwt.sign(email, process.env.SECRET_KEY, {
    //     expiresIn: '365d',
    //   })
    //   res
    //     .cookie('token', token, {
    //       httpOnly: true,
    //       secure: process.env.NODE_ENV === 'production',
    //       sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    //     })
    //     .send({ success: true })
    // })

    // // Clear token on logout
    // app.get('/logout', (req, res) => {
    //   res
    //     .clearCookie('token', {
    //       httpOnly: true,
    //       secure: process.env.NODE_ENV === 'production',
    //       sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    //       maxAge: 0,
    //     })
    //     .send({ success: true })
    // })
       // jwt related api
    // app.post('/jwt', async (req, res) => {
    //   const user = req.body;
    //   const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
    //   res.send({ token });
    // })

    // middlewares 
    // const verifyToken = (req, res, next) => {
    //   // console.log('inside verify token', req.headers.authorization);
    //   if (!req.headers.authorization) {
    //     return res.status(401).send({ message: 'unauthorized access' });
    //   }
    //   const token = req.headers.authorization.split(' ')[1];
    //   jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    //     if (err) {
    //       return res.status(401).send({ message: 'unauthorized access' })
    //     }
    //     req.decoded = decoded;
    //     next();
    //   })
    // }

    // use verify admin after verifyToken
    // const verifyAdmin = async (req, res, next) => {
    //   const email = req.decoded.email;
    //   const query = { email: email };
    //   const user = await userCollection.findOne(query);
    //   const isAdmin = user?.role === 'admin';
    //   if (!isAdmin) {
    //     return res.status(403).send({ message: 'forbidden access' });
    //   }
    //   next();
    // }

    // users related api
    app.post('/users', async (req, res) => {
      const user = req.body;
      // insert email if user doesnt exists: 
      // you can do this many ways (1. email unique, 2. upsert 3. simple checking)
      const query = { email: user.email }
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user already exists', insertedId: null })
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    
    app.get('/users', async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email;

      // if (email !== req.decoded.email) {
      //   return res.status(403).send({ message: 'forbidden access' })
      // }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      console.log(user);
      let admin = false;
      if (user) {
        console.log("user", user);
        admin = user?.role === 'admin';
      }
      res.send({ admin });
    })


    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    })

    app.delete('/users/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await userCollection.deleteOne(query);
      res.send(result);
    })

    // save a serviceData in db
    // app.post("/add-service",verifyToken, async (req, res) => {
    //   const serviceData = req.body;
    //   const result = await servicesCollection.insertOne(serviceData);
    //   console.log(result);
    //   res.send(result);
    // });
     // menu related apis
    app.get('/meal', async (req, res) => {
      const result = await mealsCollection.find().toArray();
      res.send(result);
    });

    app.get('/menu/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await menuCollection.findOne(query);
      res.send(result);
    })

    app.post('/meal', async (req, res) => {
      const item = req.body;
      const result = await mealsCollection.insertOne(item);
      res.send(result);
    });

    app.patch('/menu/:id', async (req, res) => {
      const item = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          name: item.name,
          category: item.category,
          price: item.price,
          recipe: item.recipe,
          image: item.image
        }
      }

      const result = await menuCollection.updateOne(filter, updatedDoc)
      res.send(result);
    })

    app.delete('/menu/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    })

    app.get('/reviews', async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    })

    // get all services data from db
    // app.get("/meals", async (req, res) => {
    //   const result = await mealsCollection
    //     .find()
    //     // .limit(6)
    //     .toArray();
    //   res.send(result);
    // });
       app.get("/allMeals", async (req, res) => {
      const search = req.query?.search;
      const min=req.query?.min
      const max=req.query?.max

      console.log(search);

      let query = {};

      if (search) {
        query.location = { $regex: search, $options: "i" };
      }
      if(min & max){
        query={
          ...query,
          "price":{$gte:min},
          "price":{$lte:max}
        }
      }
      const result = await mealsCollection.find(query).toArray();
      res.send(result);
    });
    // get all services posted by a specific user
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
    // delete a service data from db
    // app.delete("/service/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) };
    //   const result = await servicesCollection.deleteOne(query);
    //   res.send(result);
    // });
    // // get a single service data by id from db
    app.get("/meals/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await mealsCollection.findOne(query);
      res.send(result);
    });
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
