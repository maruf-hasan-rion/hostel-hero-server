require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
const app = express();

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://hostel-hero-38813.web.app",
  ],
  credentials: true,
  optionalSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.b4zor.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("hostel-hero");
    const usersCollection = db.collection("users");
    const mealsCollection = db.collection("meals");
    const bookingsCollection = db.collection("bookings");
    const reviewsCollection = db.collection("reviews");
    const paymentsCollection = db.collection("payments");
    const upcomingMealsCollection = db.collection("upcomingMeals");
    const notificationsCollection = db.collection("notifications");

    // ✅ Helper: Checks if the passed string represents a premium membership tier
    const isPremiumBadge = (badge = "") => {
      const b = String(badge).toLowerCase();
      return b === "silver" || b === "gold" || b === "platinum";
    };

    const verifyToken = (req, res, next) => {
      const token = req.cookies?.token;
      if (!token)
        return res.status(401).send({ message: "unauthorized access" });

      jwt.verify(token, process.env.SECRET_KEY, (err, decoded) => {
        if (err)
          return res.status(401).send({ message: "unauthorized access" });
        req.user = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.user?.email;
      if (!email)
        return res.status(401).send({ message: "unauthorized access" });

      const user = await usersCollection.findOne({ email });
      const isAdmin = user?.role === "admin";

      if (!isAdmin)
        return res.status(403).send({ message: "forbidden access" });

      next();
    };

    // ✅ Auth: Create JWT token on login/signup
    app.post("/jwt", async (req, res) => {
      const { email } = req.body;
      if (!email) return res.status(400).send({ message: "email required" });

      const token = jwt.sign({ email }, process.env.SECRET_KEY, {
        expiresIn: "365d",
      });

      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
          maxAge: 365 * 24 * 60 * 60 * 1000,
        })
        .send({ success: true });
    });

    // ✅ Auth: Clear JWT token on logout
    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
          maxAge: 0,
        })
        .send({ success: true });
    });

    // ====================== USERS ======================
    // ✅ Auth/User: Save new user in database upon registration
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;

        if (!user?.email) {
          return res.status(400).send({ message: "email required" });
        }

        const filter = { email: user.email };

        const updateDoc = {
          $setOnInsert: {
            ...user,
            createdAt: new Date(),
          },
        };

        const options = { upsert: true };

        const result = await usersCollection.updateOne(
          filter,
          updateDoc,
          options,
        );
        res.send(result);
      } catch (error) {
        console.error("POST /users error:", error);
        res.status(500).send({ message: "Failed to save user" });
      }
    });

    // ✅ Admin: Get all users with search and pagination
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const search = (req.query?.search || "").trim();
        const page = parseInt(req.query.page || "1", 10);
        const limit = parseInt(req.query.limit || "10", 10);
        const skip = (page - 1) * limit;

        let query = {};
        if (search) {
          query = {
            $or: [
              { name: { $regex: search, $options: "i" } },
              { email: { $regex: search, $options: "i" } },
            ],
          };
        }

        const total = await usersCollection.countDocuments(query);
        const users = await usersCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({ data: users, total, page, limit });
      } catch (error) {
        console.error("GET /users error:", error);
        res.status(500).send({ message: "Failed to load users" });
      }
    });

    // ✅ Private: Get current logged-in user details
    app.get("/users/me", verifyToken, async (req, res) => {
      const email = req.user.email;
      const user = await usersCollection.findOne({ email });
      res.send(user || {});
    });

    // ✅ Private: Check if current user is an Admin
    app.get("/users/admin", verifyToken, async (req, res) => {
      const email = req.user.email;
      const user = await usersCollection.findOne({ email });
      const admin = user?.role === "admin";
      res.send({ admin });
    });

    // ✅ Admin: Promote a user to Admin role
    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        try {
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id), role: { $ne: "admin" } },
            { $set: { role: "admin" } },
          );

          res.send(result);
        } catch (err) {
          res.status(400).send({ message: "Invalid user id" });
        }
      },
    );

    // ✅ Admin: Delete a user account (protects existing admins)
    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;

        // Guard: don't allow deleting admin accounts
        const target = await usersCollection.findOne({ _id: new ObjectId(id) });
        if (!target) return res.status(404).send({ message: "User not found" });
        if (target.role === "admin") {
          return res.status(403).send({ message: "Cannot delete an admin account" });
        }

        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(400).send({ message: "Invalid user id" });
      }
    });

    // ✅ Private: Load user profile page data
    app.get("/users/profile", verifyToken, async (req, res) => {
      const email = req.query.email;

      if (email !== req.user.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const user = await usersCollection.findOne({ email });
      res.send(user || {});
    });

    // ✅ Private: Update "About Me" section in user profile
    app.patch("/users/about", verifyToken, async (req, res) => {
      try {
        const email = req.user.email;
        const { aboutMe } = req.body;

        const result = await usersCollection.updateOne(
          { email },
          { $set: { aboutMe } }
        );
        res.send(result);
      } catch (err) {
        console.error("PATCH /users/about error:", err);
        res.status(500).send({ message: "server error" });
      }
    });

    // ✅ Public: Fetch total meals/users/ratings for the Home Page statistics
    app.get("/stats", async (req, res) => {
      try {
        const totalMeals = await mealsCollection.estimatedDocumentCount();
        const totalUsers = await usersCollection.estimatedDocumentCount();

        // Compute average rating from all meals
        const ratingAgg = await mealsCollection
          .aggregate([
            { $group: { _id: null, avgRating: { $avg: "$rating" } } },
          ])
          .toArray();
        const avgRating = ratingAgg[0]?.avgRating
          ? parseFloat(ratingAgg[0].avgRating.toFixed(1))
          : 0;

        res.send({ totalMeals, totalUsers, avgRating });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch stats", error: err.message });
      }
    });

    // ✅ Admin: Fetch dashboard aggregate stats (total users, meals, reviews)
    app.get("/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
      const users = await usersCollection.estimatedDocumentCount();
      const meals = await mealsCollection.estimatedDocumentCount();
      const upcomingMeals = await upcomingMealsCollection.estimatedDocumentCount();
      const reviews = await reviewsCollection.estimatedDocumentCount();

      res.send({ users, meals, upcomingMeals, reviews });
    });

    // ====================== MEALS ======================
    // ✅ Admin: Add a new finalized meal to the main collection
    app.post("/meals", verifyToken, async (req, res) => {
      try {
        const {
          title,
          category,
          image,
          ingredients,
          description,
          price,
          postTime,
          distributorName,
          distributorEmail,
        } = req.body;

        // ✅ Basic validation (assignment required fields)
        if (
          !title ||
          !category ||
          !image ||
          !ingredients ||
          !description ||
          !price ||
          !postTime ||
          !distributorName ||
          !distributorEmail
        ) {
          return res.status(400).send({ message: "All fields are required" });
        }

        // ✅ Ensure logged-in admin is the distributor
        if (req.user.email !== distributorEmail) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const meal = {
          title,
          category,
          image,
          ingredients,
          description,
          price: Number(price),
          postTime,
          distributorName,
          distributorEmail,

          // ✅ enforced defaults (client cannot fake these)
          rating: 0,
          likes: 0,
          likedBy: [],
          reviews_count: 0,

          createdAt: new Date(),
        };

        const result = await mealsCollection.insertOne(meal);
        res.send(result);
      } catch (error) {
        console.error("Add meal error:", error);
        res.status(500).send({ message: "Failed to add meal" });
      }
    });

    // ✅ Public: Get all meals with search, filters, sorting, and pagination
    app.get("/meals", async (req, res) => {
      try {
        const search = (req.query.search || "").trim();
        const category = (req.query.category || "").trim(); // breakfast/lunch/dinner
        const min = req.query.min;
        const max = req.query.max;

        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(
          Math.max(parseInt(req.query.limit || "9", 10), 1),
          24,
        );
        const skip = (page - 1) * limit;

        // ✅ build filter
        const filter = {};

        if (search) {
          filter.$or = [
            { title: { $regex: search, $options: "i" } },
            { category: { $regex: search, $options: "i" } },
            { ingredients: { $regex: search, $options: "i" } }
          ];
        }

        if (category && category !== "all") {
          // store categories as lowercase in DB (recommended)
          filter.category = category.toLowerCase();
        }

        const priceQuery = {};
        if (min !== undefined && min !== "") priceQuery.$gte = Number(min);
        if (max !== undefined && max !== "") priceQuery.$lte = Number(max);
        if (Object.keys(priceQuery).length) filter.price = priceQuery;

        // ✅ data + total (for hasMore)
        const total = await mealsCollection.countDocuments(filter);

        // ✅ build sort
        const ALLOWED_SORT = ["likes", "reviews_count", "rating", "price", "createdAt"];
        const sortField = ALLOWED_SORT.includes(req.query.sort) ? req.query.sort : "createdAt";
        const sortDir = req.query.order === "asc" ? 1 : -1;
        const sortObj = { [sortField]: sortDir };

        const items = await mealsCollection
          .find(filter)
          .sort(sortObj)
          .skip(skip)
          .limit(limit)
          .toArray();

        const hasMore = skip + items.length < total;

        res.send({
          items,
          page,
          limit,
          total,
          hasMore,
        });
      } catch (error) {
        console.error("GET /meals error:", error);
        res.status(500).send({ message: "Failed to load meals" });
      }
    });
    // ✅ Public: Fetch single meal details (including reviews_count, etc) by ID
    app.get("/meals/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await mealsCollection.findOne(query);
      res.send(result);
    });

    // ✅ Admin: Edit/Update an existing meal by ID
    app.patch("/meals/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { title, category, image, ingredients, description, price, postTime, distributorName, distributorEmail } = req.body;

        const updateDoc = {
          $set: {
            ...(title && { title }),
            ...(category && { category }),
            ...(image && { image }),
            ...(ingredients && { ingredients }),
            ...(description && { description }),
            ...(price !== undefined && { price: Number(price) }),
            ...(postTime && { postTime }),
            ...(distributorName && { distributorName }),
            ...(distributorEmail && { distributorEmail }),
            updatedAt: new Date().toISOString(),
          },
        };

        const result = await mealsCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc
        );
        res.send(result);
      } catch (error) {
        console.error("PATCH /meals/:id error:", error);
        res.status(500).send({ message: "Failed to update meal" });
      }
    });

    // ✅ Admin: Delete a meal by ID
    app.delete("/meals/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await mealsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        console.error("DELETE /meals/:id error:", error);
        res.status(500).send({ message: "Failed to delete meal" });
      }
    });

    // ✅ Private: Like a meal (enforces one like per user)
    app.post("/meals/:id/like", verifyToken, async (req, res) => {
      try {
        const mealId = req.params.id;
        const email = req.user.email;

        const meal = await mealsCollection.findOne({
          _id: new ObjectId(mealId),
        });
        if (!meal) return res.status(404).send({ message: "Meal not found" });

        // likedBy array
        const likedBy = Array.isArray(meal.likedBy) ? meal.likedBy : [];

        if (likedBy.includes(email)) {
          return res.status(409).send({ message: "Already liked" });
        }

        const result = await mealsCollection.updateOne(
          { _id: new ObjectId(mealId) },
          {
            $inc: { likes: 1 },
            $push: { likedBy: email },
          },
        );

        if (result.modifiedCount === 0) {
          return res.status(400).send({ message: "Failed to like" });
        }

        const updated = await mealsCollection.findOne({
          _id: new ObjectId(mealId),
        });
        res.send({
          success: true,
          likes: updated.likes,
          likedBy: updated.likedBy,
        });
      } catch (err) {
        console.log("POST /meals/:id/like error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ====================== REQUESTED MEALS ======================
    // ✅ Private: (Premium User) Request a meal to be delivered
    app.post("/requested-meals", verifyToken, async (req, res) => {
      try {
        const email = req.user.email;
        const { mealId, mealTitle, mealImage, userName } = req.body;

        if (!mealId)
          return res.status(400).send({ message: "mealId required" });
        if (!ObjectId.isValid(mealId))
          return res.status(400).send({ message: "invalid mealId" });

        // ✅ premium check
        const dbUser = await usersCollection.findOne({ email });
        if (!isPremiumBadge(dbUser?.badge)) {
          return res.status(403).send({ message: "Premium package required" });
        }

        // ✅ prevent duplicate (same user + same meal)
        const mealObjectId = new ObjectId(mealId);
        const exists = await bookingsCollection.findOne({
          userEmail: email,
          mealId: mealObjectId,
          status: { $in: ["pending", "delivered"] },
        });
        if (exists)
          return res.status(409).send({ message: "Already requested" });

        const doc = {
          userEmail: email,
          userName: userName || "",
          mealId: mealObjectId,
          mealTitle: mealTitle || "",
          mealImage: mealImage || "",
          status: "pending",
          createdAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(doc);
        res.send(result);
      } catch (err) {
        console.error("POST /requests error:", err);
        res.status(500).send({ message: "server error" });
      }
    });

    // ✅ Private: Get list of meals requested by the current user
    app.get("/requested-meals", verifyToken, async (req, res) => {
      const email = req.user.email;
      const page = parseInt(req.query.page || "1", 10);
      const limit = parseInt(req.query.limit || "10", 10);
      const skip = (page - 1) * limit;

      const total = await bookingsCollection.countDocuments({ userEmail: email });

      const result = await bookingsCollection
        .find({ userEmail: email })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({ data: result, total, page, limit });
    });

    // ✅ Private: Cancel a pending meal request
    app.patch("/requested-meals/cancel/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id))
        return res.status(400).send({ message: "invalid id" });

      const booking = await bookingsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!booking) return res.status(404).send({ message: "not found" });
      if (booking.userEmail !== req.user.email)
        return res.status(403).send({ message: "forbidden access" });

      // Guard: cannot cancel a delivered meal
      if (booking.status === "delivered") {
        return res.status(400).send({ message: "Cannot cancel a delivered meal" });
      }
      // Guard: already cancelled
      if (booking.status === "cancelled") {
        return res.status(400).send({ message: "Already cancelled" });
      }

      const result = await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "cancelled" } },
      );

      res.send(result);
    });

    // ✅ Admin: Fetch all requested meals with status filtering
    app.get(
      "/admin/serve-meals",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const search = (req.query?.search || "").trim();
        const status = (req.query?.status || "").trim(); // optional
        const page = parseInt(req.query.page || "1", 10);
        const limit = parseInt(req.query.limit || "10", 10);
        const skip = (page - 1) * limit;

        const match = {};
        if (status) match.status = status;
        if (search) {
          match.$or = [
            { userEmail: { $regex: search, $options: "i" } },
            { userName: { $regex: search, $options: "i" } },
          ];
        }

        const total = await bookingsCollection.countDocuments(match);

        const result = await bookingsCollection
          .find(match)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({ data: result, total, page, limit });
      },
    );

    // ✅ Admin: Change a requested meal status to 'delivered'
    app.patch(
      "/admin/serve-meals/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "invalid id" });

        // Guard: fetch booking first to check current status
        const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
        if (!booking) return res.status(404).send({ message: "not found" });

        if (booking.status === "cancelled") {
          return res.status(400).send({ message: "Cannot serve a cancelled request" });
        }
        if (booking.status === "delivered") {
          return res.status(400).send({ message: "Already delivered" });
        }

        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "delivered" } },
        );

        res.send(result);
      },
    );

    // ====================== UPCOMING MEALS ======================
    // ✅ Public: View all upcoming meals that are scheduled
    app.get("/upcoming-meals", async (req, res) => {
      try {
        const now = new Date();
        const result = await upcomingMealsCollection
          .find({ publishAt: { $gt: now } })
          .sort({ publishAt: 1 })
          .toArray();

        res.send(result);
      } catch (err) {
        console.error("GET /upcoming-meals error:", err);
        res.status(500).send({ message: "server error" });
      }
    });

    // ✅ Private: (Premium User) Like an upcoming meal
    app.post("/upcoming-meals/:id/like", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "invalid id" });
        }

        const email = req.user.email;

        // ✅ premium check
        const dbUser = await usersCollection.findOne({ email });
        if (!isPremiumBadge(dbUser?.badge)) {
          return res.status(403).send({ message: "premium required" });
        }

        // ✅ one-like-per-user
        const update = await upcomingMealsCollection.updateOne(
          { _id: new ObjectId(id), likedBy: { $ne: email } },
          { $inc: { likes: 1 }, $addToSet: { likedBy: email } },
        );

        if (update.modifiedCount === 0) {
          return res.status(409).send({ message: "already liked" });
        }

        res.send({ success: true });
      } catch (err) {
        console.error("POST /upcoming-meals/:id/like error:", err);
        res.status(500).send({ message: "server error" });
      }
    });

    
    // ✅ Admin: View all upcoming meals with total likes count
    app.get(
      "/admin/upcoming-meals",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const page = parseInt(req.query.page || "1", 10);
          const limit = parseInt(req.query.limit || "10", 10);
          const skip = (page - 1) * limit;

          const total = await upcomingMealsCollection.countDocuments();
          const result = await upcomingMealsCollection
            .find()
            .sort({ likes: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

          res.send({ data: result, total, page, limit });
        } catch (err) {
          console.error("GET /admin/upcoming-meals error:", err);
          res.status(500).send({ message: "server error" });
        }
      },
    );

    // ✅ Admin: Add a new meal to the upcoming meals list
    app.post(
      "/admin/upcoming-meals",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const email = req.user.email;
          const dbUser = await usersCollection.findOne({ email });

          const body = req.body;
          const publishAt = new Date(body.publishAt);

          if (
            !body.title ||
            !body.category ||
            !body.image ||
            !body.ingredients ||
            !body.description ||
            !body.publishAt
          ) {
            return res.status(400).send({ message: "missing required fields" });
          }

          if (Number.isNaN(publishAt.getTime())) {
            return res.status(400).send({ message: "publishAt invalid" });
          }

          const doc = {
            title: body.title,
            category: String(body.category).toLowerCase(),
            image: body.image,
            ingredients: body.ingredients,
            description: body.description,
            price: Number(body.price) || 0,

            publishAt,
            postTime: body.publishAt, // ensure schema consistency with regular meals
            distributorName: dbUser?.name || "Admin",
            distributorEmail: email,

            rating: 0,
            likes: 0,
            reviews_count: 0,
            likedBy: [],
            createdAt: new Date(),
          };

          const result = await upcomingMealsCollection.insertOne(doc);
          res.send(result);
        } catch (err) {
          console.error("POST /admin/upcoming-meals error:", err);
          res.status(500).send({ message: "server error" });
        }
      },
    );

    // ✅ Admin: Publish an upcoming meal to the main collection (requires 3+ likes)
    app.post(
      "/admin/upcoming-meals/:id/publish",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "invalid id" });
          }

          const upcoming = await upcomingMealsCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!upcoming) return res.status(404).send({ message: "not found" });

          // 🏆 Challenge Requirement: Minimum 3 likes to publish
          if (upcoming.likes < 3) {
            return res.status(400).send({
              message: "Meal must have at least 3 likes to be published."
            });
          }

          const mealDoc = {
            title: upcoming.title,
            category: upcoming.category,
            image: upcoming.image,
            ingredients: upcoming.ingredients,
            description: upcoming.description,
            price: upcoming.price,

            postTime: upcoming.postTime || new Date().toISOString(),
            distributorName: upcoming.distributorName,
            distributorEmail: upcoming.distributorEmail,

            rating: upcoming.rating || 0,
            likes: upcoming.likes || 0,
            reviews_count: upcoming.reviews_count || 0,
            likedBy: upcoming.likedBy || [],
            createdAt: upcoming.createdAt || new Date(),
          };

          const insertResult = await mealsCollection.insertOne(mealDoc);

          await upcomingMealsCollection.deleteOne({ _id: new ObjectId(id) });

          res.send({ success: true, insertedId: insertResult.insertedId });
        } catch (err) {
          console.error("POST /admin/upcoming-meals/:id/publish error:", err);
          res.status(500).send({ message: "server error" });
        }
      },
    );

    // ====================== REVIEWS ======================

    // ✅ Public: Get all reviews (optionally filtered by specific mealId)
    app.get("/reviews", async (req, res) => {
      try {
        const mealId = (req.query.mealId || "").trim();
        const query = mealId ? { mealId } : {};

        const result = await reviewsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (err) {
        console.error("GET /reviews error:", err);
        res.status(500).send({ message: "Failed to load reviews" });
      }
    });

    // ✅ Private: get my reviews (My Reviews page)
    app.get("/reviews/my", verifyToken, async (req, res) => {
      try {
        const email = (req.query.email || "").trim();
        const page = parseInt(req.query.page || "1", 10);
        const limit = parseInt(req.query.limit || "10", 10);
        const skip = (page - 1) * limit;

        if (!email || email !== req.user.email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const total = await reviewsCollection.countDocuments({ userEmail: email });

        const result = await reviewsCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({ data: result, total, page, limit });
      } catch (err) {
        console.error("GET /reviews/my error:", err);
        res.status(500).send({ message: "Failed to load reviews" });
      }
    });

    // ✅ Private: add review + increment meal reviews_count
    app.post("/reviews", verifyToken, async (req, res) => {
      try {
        const email = req.user.email;
        const { mealId, review, mealTitle, userName, userPhoto } = req.body;

        if (!mealId || !review) {
          return res
            .status(400)
            .send({ message: "mealId and review required" });
        }

        // optional: block duplicate review by same user for same meal
        const already = await reviewsCollection.findOne({
          mealId: mealId.toString(),
          userEmail: email,
        });
        if (already) {
          return res
            .status(409)
            .send({ message: "You already reviewed this meal" });
        }

        const doc = {
          mealId: mealId.toString(), // store string
          mealTitle: mealTitle || "",
          review,
          userEmail: email,
          userName: userName || "Anonymous",
          userPhoto: userPhoto || "",
          createdAt: new Date(),
        };

        const result = await reviewsCollection.insertOne(doc);

        // ✅ increase reviews_count on meal
        if (ObjectId.isValid(mealId)) {
          await mealsCollection.updateOne(
            { _id: new ObjectId(mealId) },
            { $inc: { reviews_count: 1 } },
          );
        }

        res.send(result);
      } catch (err) {
        console.error("POST /reviews error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ✅ Private: update my review
    app.patch("/reviews/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { review } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "invalid id" });
        }
        if (!review) {
          return res.status(400).send({ message: "review required" });
        }

        const existing = await reviewsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!existing) return res.status(404).send({ message: "not found" });

        if (existing.userEmail !== req.user.email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const result = await reviewsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { review, updatedAt: new Date() } },
        );

        res.send(result);
      } catch (err) {
        console.error("PATCH /reviews/:id error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ✅ Private: delete my review + decrement reviews_count
    app.delete("/reviews/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "invalid id" });
        }

        const existing = await reviewsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!existing) return res.status(404).send({ message: "not found" });

        if (existing.userEmail !== req.user.email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        // ✅ decrease reviews_count on meal
        if (existing.mealId && ObjectId.isValid(existing.mealId)) {
          await mealsCollection.updateOne(
            { _id: new ObjectId(existing.mealId) },
            { $inc: { reviews_count: -1 } },
          );
        }

        res.send(result);
      } catch (err) {
        console.error("DELETE /reviews/:id error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ✅ Admin: all reviews + simple search (by meal title)
    app.get("/admin/reviews", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const search = (req.query.search || "").trim();
        const page = parseInt(req.query.page || "1", 10);
        const limit = parseInt(req.query.limit || "10", 10);
        const skip = (page - 1) * limit;

        const query = search
          ? { mealTitle: { $regex: search, $options: "i" } }
          : {};

        const total = await reviewsCollection.countDocuments(query);

        const result = await reviewsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({ data: result, total, page, limit });
      } catch (err) {
        console.error("GET /admin/reviews error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ✅ Admin: delete any review + decrement reviews_count
    app.delete(
      "/admin/reviews/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "invalid id" });
          }

          const existing = await reviewsCollection.findOne({
            _id: new ObjectId(id),
          });
          if (!existing) return res.status(404).send({ message: "not found" });

          const result = await reviewsCollection.deleteOne({
            _id: new ObjectId(id),
          });

          if (existing.mealId && ObjectId.isValid(existing.mealId)) {
            await mealsCollection.updateOne(
              { _id: new ObjectId(existing.mealId) },
              { $inc: { reviews_count: -1 } },
            );
          }

          res.send(result);
        } catch (err) {
          console.error("DELETE /admin/reviews/:id error:", err);
          res.status(500).send({ message: "Server error" });
        }
      },
    );



    // ====================== PAYMENTS ======================
    // ✅ Private: View user's own payment history
    app.get("/payments", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (!email || email !== req.user.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const paymentsCollection = db.collection("payments");
      const total = await paymentsCollection.countDocuments({ email: email });

      const result = await paymentsCollection
        .find({ email: email })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({ data: result, total, page, limit });
    });



    // ✅ Private: Create PaymentIntent for Stripe checkout
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      try {
        const body = req.body || {};
        const packageName = body.packageName || body.package; // ✅ accept both

        if (!packageName) {
          return res.status(400).send({ message: "packageName required" });
        }

        const key = String(packageName).toLowerCase();

        const PACKAGE_PRICES = {
          silver: 999,
          gold: 1999,
          platinum: 2999,
        };

        const amount = PACKAGE_PRICES[key];
        if (!amount) {
          return res.status(400).send({ message: "Invalid package" });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
          metadata: {
            packageName: key,
            buyerEmail: req.user.email,
          },
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error("create-payment-intent error:", err);
        res.status(500).send({ message: err.message || "Server error" });
      }
    });

    // ✅ Private: Save payment & upgrade user badge
    app.post("/payments", verifyToken, async (req, res) => {
      try {
        const { packageName, amount, transactionId } = req.body;

        if (!transactionId)
          return res.status(400).send({ message: "transactionId required" });

        const paymentDoc = {
          email: req.user.email,
          packageName,
          amount,
          transactionId,
          createdAt: new Date(),
        };

        const payRes = await paymentsCollection.insertOne(paymentDoc);

        // update user badge based on package
        const badgeMap = {
          silver: "Silver",
          gold: "Gold",
          platinum: "Platinum",
        };

        const badge = badgeMap[String(packageName).toLowerCase()];
        if (badge) {
          await usersCollection.updateOne(
            { email: req.user.email },
            { $set: { badge } },
            { upsert: false },
          );
        }

        res.send({ success: true, insertedId: payRes.insertedId, badge });
      } catch (err) {
        console.error("payments error:", err);
        res.status(500).send({ message: "Failed to save payment" });
      }
    });



    // ====================== NOTIFICATIONS ======================
    // ✅ Private: Get unread notifications count (for navbar badge)
    app.get("/notifications/unread-count", verifyToken, async (req, res) => {
      const email = req.user.email;
      const count = await notificationsCollection.countDocuments({
        userEmail: email,
        isRead: false,
      });
      res.send({ count });
    });

    // ✅ Private: List notifications (with search & filter)
    app.get("/notifications", verifyToken, async (req, res) => {
      const email = req.user.email;
      const search = (req.query.search || "").trim();
      const filter = req.query.filter || "all"; // all | unread | read
      const page = parseInt(req.query.page || "1");
      const limit = parseInt(req.query.limit || "10");
      const skip = (page - 1) * limit;

      const query = { userEmail: email };

      if (filter === "unread") query.isRead = false;
      if (filter === "read") query.isRead = true;

      if (search) {
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          { message: { $regex: search, $options: "i" } },
        ];
      }

      const total = await notificationsCollection.countDocuments(query);

      const data = await notificationsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({ data, total, page, limit });
    });

    // ✅ Private: Mark single notification as read
    app.patch("/notifications/:id/read", verifyToken, async (req, res) => {
      const id = req.params.id;
      const email = req.user.email;

      const result = await notificationsCollection.updateOne(
        { _id: new ObjectId(id), userEmail: email },
        { $set: { isRead: true } },
      );

      res.send(result);
    });

    // ✅ Private: Mark all notifications as read
    app.patch("/notifications/read-all", verifyToken, async (req, res) => {
      const email = req.user.email;

      const result = await notificationsCollection.updateMany(
        { userEmail: email, isRead: false },
        { $set: { isRead: true } },
      );

      res.send(result);
    });

    // ✅ Admin: Broadcast a new notification block to all registered users
    app.post(
      "/admin/notifications/broadcast",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { title, message, type = "info" } = req.body || {};

          if (!title?.trim() || !message?.trim()) {
            return res
              .status(400)
              .send({ message: "title and message are required" });
          }

          // ✅ get all users emails (skip users without email)
          const users = await usersCollection
            .find({}, { projection: { email: 1 } })
            .toArray();

          const docs = users
            .filter((u) => u.email)
            .map((u) => ({
              userEmail: u.email,
              title: title.trim(),
              message: message.trim(),
              type,
              isRead: false,
              createdAt: new Date(),
            }));

          if (docs.length === 0) return res.send({ insertedCount: 0 });

          const result = await notificationsCollection.insertMany(docs);
          res.send({ insertedCount: result.insertedCount });
        } catch (err) {
          console.error("broadcast error:", err);
          res.status(500).send({ message: "Server error" });
        }
      },
    );

  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

// ✅ System: Base server ping endpoint to check if application is live
app.get("/", (req, res) => {
  res.send("Hostel Hero server running");
});

app.listen(port, () => console.log(`Server running on port ${port}`));

// Required for Vercel deployment
module.exports = app;
