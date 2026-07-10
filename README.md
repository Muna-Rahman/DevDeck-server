1. Clone the Repository

Open your terminal and clone the repository:

git clone https://github.com/muna-rahman/devdeck-server.git
2. Navigate to the Project Folder

Move into the project directory:

cd devdeck-server

Note: Make sure you're inside the folder that contains the package.json file.

3. Install Dependencies

Install all required Node.js packages:

npm install

This will install all dependencies listed in package.json.

4. Configure Environment Variables

Create a .env file in the project root and add the following environment variables:

# MongoDB connection string
MONGODB_URI=mongodb+srv://<username>:<password>@yourcluster.mongodb.net/devdeck

# Server port (optional)
PORT=3001

# Frontend application URL
FRONTEND_URL=http://localhost:3000

# Better Auth secret key
BETTER_AUTH_SECRET=your_long_random_secret

Important:

Replace <username> and <password> with your MongoDB credentials.
Generate a secure random value for BETTER_AUTH_SECRET.
Never commit your .env file to GitHub.
5. Run the Development Server

Start the backend server:

node index.js

If everything is configured correctly, you should see:

🚀 DevDeck Backend server running at http://localhost:3001
📁 Project Structure
devdeck-server/
├── controllers/
├── lib/
├── middleware/
├── models/
├── routes/
├── .env
├── .gitignore
├── index.js
├── package.json
└── README.md
