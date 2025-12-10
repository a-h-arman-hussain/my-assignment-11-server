require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { chownSync } = require("fs");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const app = express();
const port = 5000;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function generateTrackingId() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
}

// middleware
app.use(cors());
app.use(express.json());

const token = jwt.sign({ id: "user123" }, "secret_key", { expiresIn: "1h" });
const decoded = jwt.verify(token, "secret_key");

console.log(token, decoded);

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
    await client.connect();
    const db = client.db("scholarStreamDB");
    const usersCollection = db.collection("users");
    const scholarCollection = db.collection("scholarships");
    const applicationsCollection = db.collection("applications");
    const reviewsCollection = db.collection("reviews");
    const paymentCollection = db.collection("payments");

    // middle more with database access
    const verifyAdmin = async (req, res, next) => {
      next();
    };

    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;

      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.send(null); // important → no 404
      }

      res.send(user);
    });

    app.get("/users", verifyAdmin, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    // app.get("/users/:id", async (req, res) => {});
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || "Student" });
    });

    app.patch("/users/:id/role", verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      res.send(result);
    });

    app.delete("/users/:id", verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.post("/add-scholarship", verifyAdmin, async (req, res) => {
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
    });

    app.get("/all-scholarships", async (req, res) => {
      const result = await scholarCollection.find().toArray();
      res.send(result);
    });

    // app.get("/all-scholarships", async (req, res) => {
    //   let query = {};

    //   const {
    //     email,
    //     universityName,
    //     universityCountry,
    //     universityWorldRank,
    //     subjectCategory,
    //     scholarshipCategory,
    //     degree,
    //     search,
    //   } = req.query;

    //   if (email) query.postedUserEmail = email;
    //   if (universityName) query.universityName = universityName;
    //   if (universityCountry) query.universityCountry = universityCountry;
    //   if (subjectCategory) query.subjectCategory = subjectCategory;
    //   if (scholarshipCategory) query.scholarshipCategory = scholarshipCategory;
    //   if (degree) query.degree = degree;

    //   if (universityWorldRank) {
    //     query.universityWorldRank = { $lte: Number(universityWorldRank) };
    //   }

    //   if (search) {
    //     query.$or = [
    //       { scholarshipName: { $regex: search, $options: "i" } },
    //       { universityName: { $regex: search, $options: "i" } },
    //     ];
    //   }

    //   const result = await universityCollection
    //     .find(query)
    //     .sort({ scholarshipPostDate: -1 })
    //     .toArray();

    //   res.send(result);
    // });

    app.patch("/scholarships/:id", async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;
      const result = await scholarCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );
      res.send(result);
    });

    app.delete("/scholarships/:id", verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await scholarCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.get("/latest-scholarships", async (req, res) => {
      const result = await scholarCollection
        .find()
        .sort({ scholarshipPostDate: -1 })
        .limit(6)
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

    app.post("/apply-scholarships", async (req, res) => {
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

    app.get("/my-applications", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send([]);

      const result = await applicationsCollection
        .find({ studentEmail: email })
        .sort({ appliedAt: -1 })
        .toArray();

      res.send(result);
    });

    app.get("/my-applications/:id", async (req, res) => {
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

    app.patch("/update-application/:id", async (req, res) => {
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

    app.delete("/delete-application/:id", async (req, res) => {
      const id = req.params.id;
      const result = await applicationsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // get /applications/:id for moderator
    app.get("/applications", async (req, res) => {
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
    });

    // PATCH /applications/:id for moderator
    app.patch("/applications/:id", async (req, res) => {
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
    });

    app.post("/add-review", async (req, res) => {
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

    app.get("/reviews", async (req, res) => {
      try {
        const reviews = await reviewsCollection.find().toArray();
        res.send(reviews);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.delete("/reviews/:id", async (req, res) => {
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
    });

    app.get("/my-reviews", async (req, res) => {
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

    app.patch("/update-review/:id", async (req, res) => {
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

    app.delete("/delete-review/:id", async (req, res) => {
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
    // new
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log("paymentInfo", paymentInfo);
      const amount = Number(paymentInfo.applicationFees) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: `Please pay for: ${paymentInfo.scholarshipName}`,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          scholarshipId: paymentInfo.scholarshipId,
          scholarshipName: paymentInfo.scholarshipName,
        },
        customer_email: paymentInfo.email,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        // console.log(session);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ success: false });
        }

        const scholarshipId = session.metadata.scholarshipId;
        const trackingId = generateTrackingId();

        // use the correct field
        const userEmail = session.customer_email;
        // console.log(scholarshipId);

        const updateResult = await applicationsCollection.updateOne(
          {
            scholarshipId: scholarshipId,
            // studentEmail: userEmail,
          },
          {
            $set: {
              paymentStatus: "paid",
              trackingId: trackingId,
            },
          }
        );
        // console.log(updateResult);

        const paymentHistory = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: userEmail,
          scholarshipId: session.metadata.scholarshipId,
          scholarshipName: session.metadata.scholarshipName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };

        // const insertPayment = await paymentCollection.insertOne(paymentHistory);

        res.send({
          success: true,
          //   updatedApplication: updateResult,
          trackingId,
          transactionId: session.payment_intent,
          //   paymentInfo: insertPayment,
        });
      } catch (err) {
        console.error("Payment success error:", err);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // app.patch("/payment-success", async (req, res) => {
    //   const sessionId = req.query.session_id;
    //   const session = await stripe.checkout.sessions.retrieve(sessionId);
    //   console.log("session", session);
    //   if (session.payment_status === "paid") {
    //     const id = session.metadata.scholarshipId;
    //     const query = { _id: new ObjectId(id) };
    //     const update = {
    //       $set: {
    //         paymentStatus: "paid",
    //         trackingId: generateTrackingId(),
    //       },
    //     };
    //     const result = await applicationsCollection.updateOne(query, update);

    //     const paymentHistory = {
    //       amount: session.amount_total / 100,
    //       currency: session.currency,
    //       customerEmail: session.customer_email,
    //       scholarshipId: session.metadata.scholarshipId,
    //       scholarshipName: session.metadata.scholarshipName,
    //       transactionId: session.payment_intent,
    //       paymentStatus: session.payment_status,
    //       paidAt: new Date(),
    //     };
    //     if (session.payment_status === "paid") {
    //       const resultPayment = await paymentCollection.insertOne(
    //         paymentHistory
    //       );
    //       res.send({
    //         success: true,
    //         modifyScholar: result,
    //         trackingId: trackingId,
    //         transactionId: session.payment_intent,
    //         paymentInfo: resultPayment,
    //       });
    //     }
    //     // res.send(result);
    //   }
    // });

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
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
