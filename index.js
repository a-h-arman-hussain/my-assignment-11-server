require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
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

    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/all-scholarships", async (req, res) => {
      const result = await scholarCollection.find().toArray();
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

        // prevent duplicate application
        const exists = await applicationsCollection.findOne({
          scholarshipId: application.scholarshipId,
          userEmail: application.userEmail,
        });

        if (exists) {
          return res.send({ success: false, message: "Already applied!" });
        }

        // insert new application
        const result = await applicationsCollection.insertOne(application);

        res.send({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error("Apply Error:", err);
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    app.get("/my-applications", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send([]); // 400 Bad Request

      const result = await applicationsCollection
        .find({ studentEmail: email })
        .sort({ appliedAt: -1 })
        .toArray();

      res.send(result);
    });

    // app.post("/apply-scholarships", async (req, res) => {
    //   try {
    //     const application = req.body;

    //     // prevent duplicate application
    //     const exists = await applicationsCollection.findOne({
    //       scholarshipId: application.scholarshipId,
    //       userEmail: application.userEmail,
    //     });

    //     if (exists) {
    //       return res.send({ success: false, message: "Already applied!" });
    //     }

    //     const result = await applicationsCollection.insertOne(application);

    //     res.send({ success: true, insertedId: result.insertedId });
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).send({ success: false, message: "Server error" });
    //   }
    // });

    // payment related apis
    // new
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
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
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log("session", session);
      if (session.payment_status === "paid") {
        const id = session.metadata.scholarshipId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            trackingId: generateTrackingId(),
          },
        };
        const result = await applicationsCollection.updateOne(query, update);

        const paymentHistory = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          scholarshipId: session.metadata.scholarshipId,
          scholarshipName: session.metadata.scholarshipName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
        };
        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(
            paymentHistory
          );
          res.send({
            success: true,
            modifyScholar: result,
            paymentInfo: resultPayment,
          });
        }
        // res.send(result);
      }
    });

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
