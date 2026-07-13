import "dotenv/config"; 
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";

const app = express();
// Uses the port given by the hosting platform, or falls back to 3001 locally
const PORT = process.env.PORT || 3001;

// trusted domains

const allowedOrigins = [
  "http://localhost:3000",             
  "https://devdeck-two.vercel.app",    
  "https://devdeck-server.vercel.app" 
];

// Configure  safety gate
app.use(cors({
  origin: function (origin, callback) {
   
    if (!origin) return callback(null, true);
    
    // Check if the incoming request domain matches any item in our trusted list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true); 
    } else {
      callback(new Error('Security Block: Not allowed by CORS protocols')); 
    }
  },
  credentials: true, //  Allows login cookies and sessions to cross over safely
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"]
}));

// Better Auth route handler. 

app.use("/api/auth", (req, res) => {
  return toNodeHandler(auth)(req, res);
});


app.use(express.json());

// for checking server is running or not
app.get("/", (req, res) => {
  res.send("DevDeck Server is running successfully.");
});

// local development mode e server run kora
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(` DevDeck Backend server running at http://localhost:${PORT}`);
  });
} else {
  // Deployed live on Vercel cloud serverless setups
  console.log("DevDeck Backend loaded in Serverless Production Mode.");
}

// Export so vercel can run this serverless function when deployed live
export default app;