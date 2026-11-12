

import { MongoClient, ObjectId } from 'mongodb';
import express from "express";
import cors from "cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import 'dotenv/config'

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());


const client = new MongoClient(process.env.MONGODB_URI);
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
  return typeof id === "string" && /^[a-f\d]{24}$/i.test(id);
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

let authJwks;

const verifyToken = async (req, res, next) => {
  const authUrl = String(process.env.CLIENT_URL ?? "").replace(/\/+$/, "");
  const authorization = req.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!token) return sendError(res, 401, "Please sign in first");
  if (!authUrl) return sendError(res, 503, "Authentication is not configured");

  try {
    if (!authJwks) {
      authJwks = createRemoteJWKSet(new URL("/api/auth/jwks", `${authUrl}/`));
    }

    const { payload } = await jwtVerify(token, authJwks, {
      issuer: authUrl,
      audience: authUrl,
    });
    if (!payload.sub || typeof payload.email !== "string") {
      return sendError(res, 401, "Invalid authentication token");
    }

    req.user = {
      id: payload.sub,
      email: payload.email.trim().toLowerCase(),
      name: typeof payload.name === "string" ? payload.name : "",
      image: typeof payload.image === "string" ? payload.image : "",
    };
    return next();
  } catch (error) {
    console.error("JWT verification failed:", error);
    return sendError(res, 401, "Invalid or expired authentication token");
  }
};

function getStudioUser(req) {
  return req.user ?? null;
}



app.post("/add-studios",verifyToken, async (req, res) => {
  const user = getStudioUser(req, res);
  if (!user) return;

  try {
    const studioData = {
      ...req.body,
      ownerEmail: user.email,
      ownerName: user.name,
      ownerImage: user.image,
      createdAt: new Date().toISOString(),
    };
    const result = await studiocollection.insertOne(studioData);
    return res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error inserting data into MongoDB");
  }
});

// http://localhost:8000/add-studios

app.get("/allStudios", async (req,res) => {
  try { 
    const result = await studiocollection.find().toArray();
    return res.json(result);
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


app.patch("/studio/:id",verifyToken, async (req, res) => {
  const user = getStudioUser(req, res);
  if (!user) return;

  try {
    const { id } = req.params;
    if (!isValidId(id)) return sendError(res, 400, "Invalid studio ID");

    const studioData = { ...req.body };
    delete studioData._id;
    delete studioData.ownerEmail;
    delete studioData.ownerName;
    delete studioData.ownerImage;

    const result = await studiocollection.updateOne(
      { _id: new ObjectId(id), ownerEmail: user.email },
      { $set: { ...studioData, updatedAt: new Date().toISOString() } },
    );

    if (result.matchedCount === 0) {
      return sendError(res, 404, "Studio not found");
    }

    return res.json({ message: "Studio updated successfully" });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, "Failed to update studio");
  }
});


//http://localhost:8000/studios/:id







// Studio listings that belong to one host.
app.get("/my-studios", verifyToken, async (req, res) => {
  const user = getStudioUser(req, res);
  if (!user) return;

  try {
    const studios = await studiocollection
      .find({ ownerEmail: user.email })
      .sort({ createdAt: -1 })
      .toArray();

    return res.json(studios);
  } catch (error) {
    console.error(error);
    return sendError(res, 500, "Failed to retrieve host studios");
  }
});

// Delete a listing only when the email matches its owner.
app.delete("/studio/:id", verifyToken, async (req, res) => {
  const user = getStudioUser(req, res);
  if (!user) return;

  try {
    const { id } = req.params;
    if (!isValidId(id)) return sendError(res, 400, "Invalid studio ID");

    const result = await studiocollection.deleteOne({
      _id: new ObjectId(id),
      ownerEmail: user.email,
    });
    if (result.deletedCount === 0) {
      return sendError(res, 404, "Studio not found or you are not its owner");
    }

    return res.json({ deleted: true });
  } catch (error) {
    console.error(error);
    return sendError(res, 500, "Failed to delete studio");
  }
});

const bookingCollection = db.collection("bookings");
const bookingSlotsCollection = db.collection("bookingSlots");
await bookingSlotsCollection.createIndex(
  { studioId: 1, date: 1, hour: 1 },
  { unique: true, name: "unique_studio_date_hour" },
);

function getBookingUser(req) {
  return req.user ?? null;
}

function sameEmail(first, second) {
  return String(first ?? "").trim().toLowerCase() === String(second ?? "").trim().toLowerCase();
}

function serializeBooking(booking, studio) {
  return {
    ...booking,
    _id: booking._id.toString(),
    studio: studio ? { ...studio, _id: studio._id.toString() } : null,
  };
}

async function getBookingWithStudio(booking) {
  const studio = isValidId(booking.studioId)
    ? await studiocollection.findOne({ _id: new ObjectId(booking.studioId) })
    : null;
  return serializeBooking(booking, studio);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  return true;
}

// A customer asks to book a studio.
app.post("/booking", verifyToken, async (req, res) => {
  const user = getBookingUser(req, res);
  if (!user) return;

  try {
    const bookingData = req.body ?? {};
    const { studioId, date, startTime, endTime } = bookingData;
    if (!isValidId(studioId)) return sendError(res, 400, "A valid studio ID is required");
    if (!validDate(date) || !validTime(startTime) || !validTime(endTime)) {
      return sendError(res, 400, "A valid date and start/end times are required");
    }

    const scheduledEnd = new Date(`${date}T${endTime}:00.000Z`);
    if (!Number.isFinite(scheduledEnd.getTime())) {
      return sendError(res, 400, "A valid booking end time is required");
    }
    const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
    const endMinutes = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3));
    if (endMinutes <= startMinutes) return sendError(res, 400, "End time must be after start time");
    if (startMinutes % 60 !== 0 || endMinutes % 60 !== 0) {
      return sendError(res, 400, "Bookings must start and end on the hour");
    }

    const studio = await studiocollection.findOne({ _id: new ObjectId(studioId) });
    if (!studio) return sendError(res, 404, "Studio not found");
    if (sameEmail(studio.ownerEmail, user.email)) {
      return sendError(res, 400, "You cannot book your own studio");
    }

    const durationHours = (endMinutes - startMinutes) / 60;
    const hourlyRate = Number(studio.hourlyRate ?? 0);
    const securityDeposit = Number(studio.securityDeposit ?? 0);
    const minimumDuration = Number(studio.minimumDuration ?? 1);
    if (!Number.isFinite(hourlyRate) || hourlyRate < 0 || !Number.isFinite(securityDeposit) || securityDeposit < 0) {
      return sendError(res, 400, "Studio pricing is invalid");
    }
    if (durationHours < minimumDuration) {
      return sendError(res, 400, `This studio requires at least ${minimumDuration} hours`);
    }

    const conflict = await bookingCollection.findOne({
      studioId,
      date,
      status: { $ne: "Cancelled" },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    });
    if (conflict) return sendError(res, 409, "This time slot is already booked");

    // The form sends only the studio and requested time. Build the saved booking
    // from values checked here and the signed-in user.
    const bookingId = new ObjectId();
    const bookingReference = `FR-${bookingId.toString().slice(-8).toUpperCase()}`;
    const confirmedAt = new Date().toISOString();
    const booking = {
      _id: bookingId,
      bookingReference,
      invoiceNumber: `INV-${bookingReference}`,
      studioId,
      date,
      startTime,
      endTime,
      endAt: scheduledEnd.toISOString(),
      durationHours,
      hourlyRate,
      hourlyAmount: hourlyRate * durationHours,
      securityDeposit,
      totalAmount: hourlyRate * durationHours + securityDeposit,
      title: studio.title ?? "Studio",
      coverImageUrl: studio.coverImageUrl ?? "",
      category: studio.category ?? "",
      address: studio.address ?? "",
      status: "Confirmed",
      confirmedAt,
      customerName: user.name,
      customerEmail: user.email,
      ownerName: studio.ownerName ?? "",
      ownerEmail: String(studio.ownerEmail ?? "").trim().toLowerCase(),
      createdAt: confirmedAt,
    };

    const slots = [];
    for (let hour = startMinutes / 60; hour < endMinutes / 60; hour += 1) {
      slots.push({ studioId, date, hour, bookingId: bookingId.toString() });
    }

    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await bookingSlotsCollection.insertMany(slots, { session });
        await bookingCollection.insertOne(booking, { session });
      });
    } catch (error) {
      if (error?.code === 11000) {
        return sendError(res, 409, "This time slot is already booked");
      }
      throw error;
    } finally {
      await session.endSession();
    }

    return res.status(201).json(await getBookingWithStudio(booking));
  } catch (error) {
    console.error(error);
    return sendError(res, 500, "Failed to create booking");
  }
});

// A customer reads their bookings.
app.get("/my-booking", verifyToken, async (req, res) => {
  const user = getBookingUser(req, res);
  if (!user) return;

  try {
    const bookings = await bookingCollection
      .find({ customerEmail: user.email })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json(await Promise.all(bookings.map(getBookingWithStudio)));
  } catch (error) {
    console.error(error);
    return sendError(res, 500, "Failed to retrieve bookings");
  }
});

// A host reads bookings for their studios.
app.get("/host-bookings", verifyToken, async (req, res) => {
  const user = getBookingUser(req, res);
  if (!user) return;

  try {
    const ownerEmailPattern = `^${user.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
    const studios = await studiocollection
      .find({ ownerEmail: { $regex: ownerEmailPattern, $options: "i" } })
      .project({ _id: 1 })
      .toArray();
    res.set("x-framio-has-studios", studios.length > 0 ? "true" : "false");
    const studioIds = studios.map((studio) => studio._id.toString());
    if (studioIds.length === 0) return res.json([]);

    const bookings = await bookingCollection
      .find({
        $or: [
          { studioId: { $in: [...studioIds, ...studios.map((studio) => studio._id)] } },
          { ownerEmail: { $regex: ownerEmailPattern, $options: "i" } },
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json(await Promise.all(bookings.map(getBookingWithStudio)));
  } catch (error) {
    console.error(error);
    return sendError(res, 500, "Failed to retrieve host bookings");
  }
});

// Hosts confirm bookings. Customers can cancel their pending bookings.
// Hosts can mark confirmed bookings as completed.
app.patch("/booking/:id/:action", verifyToken, async (req, res) => {
  const user = getBookingUser(req, res);
  if (!user) return;

  try {
    const { id, action } = req.params;
    if (!isValidId(id)) return sendError(res, 400, "Invalid booking ID");
    if (!["confirm", "cancel", "complete"].includes(action)) return sendError(res, 404, "Booking action not found");

    const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) return sendError(res, 404, "Booking not found");

    const isCustomer = sameEmail(booking.customerEmail, user.email);
    const isHost = sameEmail(booking.ownerEmail, user.email);

    if (action === "confirm" && !isHost) {
      return sendError(res, 403, "Only the studio host can confirm this booking");
    }
    if (action === "cancel" && !isCustomer && !isHost) {
      return sendError(res, 403, "You cannot cancel this booking");
    }
    if (action === "complete" && !isHost) {
      return sendError(res, 403, "Only the studio host can complete this booking");
    }

    let requiredStatus = "Pending";
    if (action === "complete") requiredStatus = "Confirmed";
    if (action === "cancel") {
      if (!["Pending", "Confirmed"].includes(booking.status)) {
        return sendError(res, 409, "Only pending or confirmed bookings can be cancelled");
      }
      requiredStatus = booking.status;
    } else if (booking.status !== requiredStatus) {
      return sendError(res, 409, `Only ${requiredStatus.toLowerCase()} bookings can be changed this way`);
    }

    const now = new Date().toISOString();
    let update = {};
    if (action === "confirm") {
      update = { status: "Confirmed", confirmedAt: now };
    } else if (action === "complete") {
      update = { status: "Completed", completedAt: now };
    } else {
      update = { status: "Cancelled", cancelledAt: now };
    }

    let updateResult;
    if (action === "cancel") {
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          updateResult = await bookingCollection.updateOne(
            { _id: booking._id, status: requiredStatus },
            { $set: update },
            { session },
          );
          if (updateResult.matchedCount > 0) {
            await bookingSlotsCollection.deleteMany(
              { bookingId: booking._id.toString() },
              { session },
            );
          }
        });
      } finally {
        await session.endSession();
      }
    } else {
      updateResult = await bookingCollection.updateOne(
        { _id: booking._id, status: requiredStatus },
        { $set: update },
      );
    }
    if (updateResult.matchedCount === 0) {
      return sendError(res, 409, "This booking was already changed");
    }

    const updatedBooking = { ...booking, ...update };
    return res.json(await getBookingWithStudio(updatedBooking));
  } catch (error) {
    console.error(error);
    return sendError(res, 500, "Failed to update booking");
  }
});

// Return booking details used by the frontend to create its PDF invoice.
app.get("/booking/:id/invoice", verifyToken, async (req, res) => {
  const user = getBookingUser(req, res);
  if (!user) return;

  try {
    const { id } = req.params;
    if (!isValidId(id)) return sendError(res, 400, "Invalid booking ID");
    const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) return sendError(res, 404, "Booking not found");
    if (!sameEmail(booking.ownerEmail, user.email) && !sameEmail(booking.customerEmail, user.email)) {
      return sendError(res, 403, "You cannot view this invoice");
    }
    if (!["Confirmed", "Completed"].includes(booking.status)) {
      return sendError(res, 409, "Invoices are available for confirmed bookings");
    }
    return res.json(await getBookingWithStudio(booking));
  } catch (error) {
    console.error(error);
    return sendError(res, 500, "Failed to retrieve invoice");
  }
});


app.listen(PORT, ()=> {
    console.log(`The server is running on port ${PORT}`);
});
