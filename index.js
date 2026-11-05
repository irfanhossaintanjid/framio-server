

import { MongoClient, ObjectId } from 'mongodb';
import express from "express";
import cors from "cors";
import 'dotenv/config'

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
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

function isValidId(id) {
  return ObjectId.isValid(id);
}

function sendError(res, status, message) {
  return res.status(status).json({ message });
}


app.post("/add-studios", async (req,res) => {
  try {
    
   const studiosData = req.body;
   const result = await studiocollection.insertOne(studiosData);
   res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error inserting data into MongoDB");
  }
});

// http://localhost:8000/studios

app.get("/allStudios", async (req,res) => {
  try { 
    const result = await studiocollection.find().limit(6).toArray();
    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving data from MongoDB");
  }
});


app.get("/studio/:id", async (req, res) => {
     const {id} = req.params;

  try {
    if (!isValidId(id)) return sendError(res, 400, "Invalid studio ID");
  
    const result = await studiocollection.findOne( { _id: new ObjectId(id) });
    if (!result) return sendError(res, 404, "Studio not found");
    res.send(result);
  } catch (error) {
    console.error(error);
    sendError(res, 500, "Failed to retrieve studio");
  }
});

//http://localhost:8000/studios/:id






app.listen(PORT, ()=> {
    console.log(`The server is running on port ${PORT}`);
});
