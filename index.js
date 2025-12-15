require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const crypto = require("crypto");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const app = express();
const port = 5000;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const admin = require("firebase-admin");

// const serviceAccount = require("./serviceKey.json");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
}

// middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xrhyseu.mongodb.net/?appName=Cluster0`;

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
    // await client.connect();
    const db = client.db("scholarStreamDB");
    const usersCollection = db.collection("users");
    const scholarCollection = db.collection("scholarships");
    const applicationsCollection = db.collection("applications");
    const reviewsCollection = db.collection("reviews");

    // middle more with database access
    // admin verification
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "Admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    app.get("/users", verifyFBToken, verifyAdmin, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    app.get("/users/:email/role", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "Student" });
    });

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { role } = req.body;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );
        res.send(result);
      }
    );

    app.delete("/users/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.post(
      "/add-scholarship",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const scholarship = req.body;
          const result = await scholarCollection.insertOne(scholarship);
          res.send({ success: true, insertedId: result.insertedId });
        } catch (err) {
          console.error("Add Scholarship Error:", err);
          res
            .status(500)
            .send({ success: false, message: "Internal server error" });
        }
      }
    );

    app.patch(
      "/scholarships/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const updateData = req.body;
        const result = await scholarCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res.send(result);
      }
    );

    app.delete(
      "/scholarships/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const result = await scholarCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    // moderator verification
    const verifyModerator = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "Moderator") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // PATCH /applications/:id for moderator
    app.patch(
      "/applications/:id",
      verifyFBToken,
      verifyModerator,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { status } = req.body;

          const result = await applicationsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { applicationStatus: status } }
          );

          res.send({ success: true, modifiedCount: result.modifiedCount });
        } catch (err) {
          console.error(err);
          res
            .status(500)
            .send({ success: false, message: "Internal server error" });
        }
      }
    );

    app.get("/reviews", verifyFBToken, verifyModerator, async (req, res) => {
      try {
        const reviews = await reviewsCollection.find().toArray();
        res.send(reviews);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.delete(
      "/reviews/:id",
      verifyFBToken,
      verifyModerator,
      async (req, res) => {
        try {
          const id = req.params.id;

          const result = await reviewsCollection.deleteOne({
            _id: new ObjectId(id),
          });

          res.send(result);
        } catch (err) {
          console.error(err);
          res.status(500).send({ message: "Internal server error" });
        }
      }
    );

    // -----------------------------------------------------------------

    // get, edit & delete for admin &moderator

    const verifyAdminOrModerator = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await usersCollection.findOne({ email });

      if (!user || (user.role !== "Admin" && user.role !== "Moderator")) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };

    app.get(
      "/applications",
      verifyFBToken,
      verifyAdminOrModerator,
      async (req, res) => {
        try {
          const applications = await applicationsCollection
            .find()
            .sort({ appliedAt: -1 })
            .toArray();
          res.send(applications);
        } catch (err) {
          console.error(err);
          res
            .status(500)
            .send({ success: false, message: "Internal server error" });
        }
      }
    );

    // --------------------------------------------------------------

    app.post("/users", verifyFBToken, async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      if (!user) {
        return res.send(null);
      }
      res.send(user);
    });

    // PATCH /users/update
    app.patch("/users/update", verifyFBToken, async (req, res) => {
      try {
        const { photo, name, cover } = req.body;

        const email = req.decoded_email; // decoded_email থেকে নাও
        const updateData = {};
        if (photo) updateData.photo = photo;
        if (name) updateData.name = name;
        if (cover) updateData.cover = cover;

        const result = await client
          .db("scholarStreamDB")
          .collection("users")
          .updateOne({ email }, { $set: updateData });

        if (result.matchedCount === 0)
          return res.status(404).send({ message: "User not found" });

        res.send({ success: true, updatedFields: updateData });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    app.get("/all-scholarships", async (req, res) => {
      const result = await scholarCollection.find().toArray();
      res.send(result);
    });

    app.get("/scholarships", async (req, res) => {
      try {
        const {
          search,
          subjectCategory,
          scholarshipCategory,
          degree,
          sortField = "postDate",
          sortOrder = "desc",
        } = req.query;

        const query = {};

        if (search) {
          query.$or = [
            { scholarshipName: { $regex: search, $options: "i" } },
            { universityName: { $regex: search, $options: "i" } },
            { degree: { $regex: search, $options: "i" } },
          ];
        }

        if (subjectCategory) query.subjectCategory = subjectCategory;
        if (scholarshipCategory)
          query.scholarshipCategory = scholarshipCategory;
        if (degree) query.degree = degree;

        let sortObj = {};
        if (sortField === "applicationFees") {
          sortObj[sortField] = sortOrder === "desc" ? -1 : 1;
        } else if (sortField === "postDate") {
          sortObj[sortField] = sortOrder === "desc" ? -1 : 1;
        }

        const scholarships = await scholarCollection
          .find(query)
          .sort(sortObj)
          .toArray();

        res.send(scholarships);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.get("/latest-scholarships", async (req, res) => {
      const result = await scholarCollection
        .find()
        .sort({ postDate: -1 })
        .limit(8)
        .toArray();
      res.send(result);
    });

    app.get("/scholarship-details/:id", async (req, res) => {
      const { id } = req.params;
      const result = await scholarCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get("/scholarship/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await scholarCollection.findOne(query);
      res.send(result);
    });

    app.post("/apply-scholarships", verifyFBToken, async (req, res) => {
      try {
        const application = req.body;

        console.log(application);

        const exists = await applicationsCollection.findOne({
          scholarshipId: application.scholarshipId,
          studentEmail: application.studentEmail,
        });

        if (exists) {
          return res.send({ success: false, message: "Already applied!" });
        }

        const result = await applicationsCollection.insertOne(application);

        res.send({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    app.get("/my-applications", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send([]);

      const result = await applicationsCollection
        .find({ studentEmail: email })
        .sort({ appliedAt: -1 })
        .toArray();

      res.send(result);
    });

    app.get("/my-applications/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await applicationsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result)
          return res.status(404).send({ message: "Application not found" });

        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.patch("/update-application/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const body = req.body;

        const updateData = {
          ...body,
          address: body.address,
          phone: body.phone,
          previousEducation: body.previousEducation,
        };

        const update = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res
          .status(200)
          .json({ success: true, modifiedCount: update.modifiedCount });
      } catch (error) {
        console.log(error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    });

    app.delete("/delete-application/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const result = await applicationsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.post("/add-review", verifyFBToken, async (req, res) => {
      try {
        const review = req.body;
        const { studentEmail, scholarshipId } = review;
        const existingReview = await reviewsCollection.findOne({
          studentEmail,
          scholarshipId,
        });

        if (existingReview) {
          return res.status(400).send({
            success: false,
            message: "You have already submitted a review for this scholarship",
          });
        }
        const result = await reviewsCollection.insertOne(review);
        res.send({ success: true, reviewId: result.insertedId });
      } catch (err) {
        console.error("Add review error:", err);
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    app.get("/my-reviews", verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;
        if (!email)
          return res
            .status(400)
            .send({ success: false, message: "Email required" });

        const reviews = await reviewsCollection
          .find({ studentEmail: email })
          .sort({ reviewDate: -1 })
          .toArray();

        res.send(reviews);
      } catch (err) {
        console.error("Get reviews error:", err);
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    app.patch("/update-review/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;

        const result = await reviewsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (err) {
        console.error("Update review error:", err);
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    app.delete("/delete-review/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (err) {
        console.error("Delete review error:", err);
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    app.get("/reviews/:scholarshipName", async (req, res) => {
      const name = req.params.scholarshipName;

      try {
        const reviews = await reviewsCollection
          .find({ scholarshipName: name })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(reviews);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to load reviews" });
      }
    });

    // payment related apis
    app.post("/payments/init", verifyFBToken, async (req, res) => {
      const {
        applicationId,
        scholarshipId,
        scholarshipName,
        universityName,
        amount,
        userEmail,
        studentEmail,
        studentName,
      } = req.body;

      if (!applicationId || !amount) {
        return res.status(400).send({ message: "Missing required fields" });
      }

      const application = await applicationsCollection.findOne({
        _id: new ObjectId(applicationId),
        paymentStatus: "pending",
      });

      if (!application) {
        return res
          .status(400)
          .send({ message: "Invalid or already paid application" });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: userEmail,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: scholarshipName },
              unit_amount: amount * 100,
            },
            quantity: 1,
          },
        ],
        metadata: { applicationId },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}&applicationId=${applicationId}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
    });

    app.patch(
      "/payments/complete/:applicationId",
      verifyFBToken,
      async (req, res) => {
        const { sessionId } = req.body;
        const { applicationId } = req.params;

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ message: "Payment not completed" });
        }

        const trackingId = generateTrackingId();

        await applicationsCollection.updateOne(
          { _id: new ObjectId(applicationId) },
          {
            $set: {
              paymentStatus: "paid",
              applicationStatus: "processing",
              transactionId: session.payment_intent,
              paidAt: new Date(),
              trackingId,
            },
          }
        );

        const updatedApplication = await applicationsCollection.findOne({
          _id: new ObjectId(applicationId),
        });

        res.send(updatedApplication);
      }
    );

    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
