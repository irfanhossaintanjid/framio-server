import { MongoClient } from 'mongodb';
import express from "express";
import cors from "cors";
import 'dotenv/config'

const PORT = 5000;
const app = express();


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

connectToMongoDB();


app.use(cors());
app.use(express.json());

app.get("/",(req,res) => {
 res.send("Hello world!");
})


app.listen(PORT, ()=> {
    console.log(`The server is running on port ${PORT}`);
});




// git init
// git add README.md
// git commit -m "first commit"
// git branch -M main
// git remote add origin https://github.com/irfanhossaintanjid/framio-server.git
// git push -u origin main