import { MongoClient } from 'mongodb';
import express from "express";
import cors from "cors";
import 'dotenv/config'

const app = express();
const PORT = 5000;

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true,
}));
app.use(express.json());


const client = new MongoClient(process.env.MONGO_URI);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectClient = await connectToMongoDB();
const db = connectClient.db("Framio");
const studiocollection = db.collection("studios");
app.post("/studios", async (req,res) => {
  try {
    
   const studiosData = req.body;
   const result = await studiocollection.insertOne(studiosData);
   res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error inserting data into MongoDB");
  }
});

// http://localhost:5000/studios

app.get("/studios", async (req,res) => {
  try { 
    const result = await studiocollection.find().limit(6).toArray();
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving data from MongoDB");
  }
});








app.listen(PORT, ()=> {
    console.log(`The server is running on port ${PORT}`);
});


