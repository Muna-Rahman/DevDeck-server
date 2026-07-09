Step 1: Open Your Terminal and Clone the Repository
Open your terminal (Command Prompt, PowerShell, or Terminal on macOS/Linux) and clone the repository using Git. Replace the URL with your repository's actual clone URL if different:

Bash
git clone https://github.com/muna-rahman/devdeck-server.git
Step 2: Navigate into the Project Directory
Change your current working directory to the cloned repository folder:

Bash
cd devdeck-server
(Note: If your local directory structure unzips or clones into the inner folder name, make sure you navigate to the folder containing package.json).

Step 3: Install the Node.js Dependencies
This project uses several external libraries like Express, Better Auth, and MongoDB. Download and install them by running:

Bash
npm install
This reads your package.json and cleanly installs everything listed into a local node_modules directory.

Step 4: Create a Local Environment Configuration File
The server requires secret credentials to connect to your database and handle security encryption. These are purposefully ignored from Git via .gitignore.

Create a file named .env in the root folder.

Open .env in a code editor (like VS Code) and add the following keys:

Code snippet
# Your MongoDB connection string (e.g., from MongoDB Atlas or local MongoDB)
MONGODB_URI=mongodb+srv://<username>:<password>@yourcluster.mongodb.net/devdeck

# Port configuration (Defaults to 3001 if left blank)
PORT=3001

# URL targeting your frontend client development server
FRONTEND_URL=http://localhost:3000

# Required by Better Auth for signing session tokens and encryption
BETTER_AUTH_SECRET=a_long_random_secret_string_here
(Make sure to swap out <username> and <password> with your real MongoDB cluster login credentials, or the server will crash on initialization).

Step 5: Start the Development Server
Since "type": "module" is configured in your configuration, you can execute the main application directly using Node.js:

Bash
node index.js
If the environment variable file is loaded correctly and the database connects, your terminal will output:

Plaintext
🚀 DevDeck Backend server running at http://localhost:3001
