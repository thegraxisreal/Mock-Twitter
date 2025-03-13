const express = require('express');
const { spawn } = require('child_process');
const fetch = require('node-fetch');
const fs = require('fs').promises; // Add fs.promises for async file operations
const app = express();
const PORT = 3000;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory storage (will be loaded from/saved to files)
let users = {};
let tweets = [];
let classrooms = []; // Added for classrooms
let announcements = [];

// Function to save data to JSON files
async function saveData() {
  try {
    await fs.writeFile('users.json', JSON.stringify(users, null, 2));
    await fs.writeFile('tweets.json', JSON.stringify(tweets, null, 2));
    await fs.writeFile('classrooms.json', JSON.stringify(classrooms, null, 2)); // Added for classrooms
    await fs.writeFile('announcements.json', JSON.stringify(announcements, null, 2));
    console.log('Data saved to users.json, tweets.json, classrooms.json, and announcements.json');
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

// Function to load data from JSON files
async function loadData() {
  try {
    const usersData = await fs.readFile('users.json', 'utf8');
    users = JSON.parse(usersData);
    console.log('Users loaded from users.json');
  } catch (err) {
    if (err.code === 'ENOENT') console.log('No users.json found, starting fresh');
    else console.error('Error loading users:', err);
  }
  try {
    const tweetsData = await fs.readFile('tweets.json', 'utf8');
    tweets = JSON.parse(tweetsData);
    console.log('Tweets loaded from tweets.json');
  } catch (err) {
    if (err.code === 'ENOENT') console.log('No tweets.json found, starting fresh');
    else console.error('Error loading tweets:', err);
  }
  try {
    const classroomsData = await fs.readFile('classrooms.json', 'utf8');
    classrooms = JSON.parse(classroomsData);
    console.log('Classrooms loaded from classrooms.json');
  } catch (err) {
    if (err.code === 'ENOENT') console.log('No classrooms.json found, starting fresh');
    else console.error('Error loading classrooms:', err);
  }
  try {
    const announcementsData = await fs.readFile('announcements.json', 'utf8');
    announcements = JSON.parse(announcementsData);
    console.log('Announcements loaded from announcements.json');
  } catch (err) {
    if (err.code === 'ENOENT') console.log('No announcements.json found, starting fresh');
    else console.error('Error loading announcements:', err);
  }
}

// Load data when the server starts
loadData().then(() => {
  console.log('Initial data load complete');
});

// Your existing endpoints
app.post('/api/deepseek', (req, res) => {
  const userInput = req.body.input;
  const child = spawn('ollama', ['run', 'deepseek-r1:14b']);
  let output = '';
  child.stdout.on('data', (data) => output += data.toString());
  child.stderr.on('data', (data) => console.error(`stderr: ${data}`));
  child.on('close', (code) => res.json({ output }));
  child.stdin.write(userInput);
  child.stdin.end();
});

app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("URL parameter is required");
  try {
    const response = await fetch(targetUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });
    if (!response.ok) return res.status(response.status).send(`Error fetching URL: ${response.status}`);
    res.set("Content-Type", response.headers.get("content-type") || "text/html");
    response.body.pipe(res);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Error fetching the requested URL");
  }
});

app.post('/admin/shutdown', async (req, res) => {
  res.send('Shutting down...');
  await saveData(); // Save data before shutting down
  process.exit(0);
});

const http = require('http').createServer(app);
const io = require('socket.io')(http);
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.on('chat message', (msg) => io.emit('chat message', msg));
  socket.on('tic move', (data) => io.emit('tic move', data));
  socket.on('join tic', () => io.emit('game start'));
  socket.on('loud noise', () => io.emit('loud noise'));
  socket.on('disconnect', () => console.log('A user disconnected'));
});

app.post('/api/signup', (req, res) => {
  const { handle, password } = req.body;
  if (!handle || !password) return res.status(400).json({ success: false, error: "Handle and password required" });
  if (users[handle.toLowerCase()]) return res.status(400).json({ success: false, error: "User already exists" });
  users[handle.toLowerCase()] = { handle, password, bio: "", profilePicture: null, verified: null, banned: false };
  return res.json({ success: true, message: "User created successfully", handle });
});

app.post('/api/login', (req, res) => {
  const { handle, password } = req.body;
  if (!handle || !password) return res.status(400).json({ success: false, error: "Handle and password required" });
  const user = users[handle.toLowerCase()];
  if (!user) return res.status(404).json({ success: false, error: "User not found" });
  if (user.banned) return res.status(403).json({ success: false, error: "Account suspended" });
  if (user.password !== password) return res.status(401).json({ success: false, error: "Incorrect password" });
  return res.json({ success: true, message: "Login successful", handle: user.handle });
});

app.post('/api/tweet', (req, res) => {
  console.log("Received /api/tweet request:", req.body);
  const { handle, text, imageData, quotedTweet, poll } = req.body;
  if (!handle || (!text && !quotedTweet && !poll)) {
    console.log("Validation failed: Missing handle or content");
    return res.status(400).json({ success: false, error: "Handle and either text, quoted tweet, or poll required" });
  }
  const user = users[handle.toLowerCase()];
  if (user.banned) {
    console.log("User banned:", handle);
    return res.status(403).json({ success: false, error: "Account suspended" });
  }
  const newTweet = {
    id: Date.now(),
    handle,
    text: text || "",
    imageData: imageData || null,
    timestamp: Date.now(),
    likes: 0,
    replies: [],
    poll: poll || null,
    quotedTweet: quotedTweet ? { ...quotedTweet, profilePicture: users[quotedTweet.handle.toLowerCase()]?.profilePicture || null, verified: users[quotedTweet.handle.toLowerCase()]?.verified || null } : null,
    last_retweeted_by: null,
    profilePicture: user?.profilePicture || null,
    verified: user?.verified || null
  };
  tweets.push(newTweet);
  io.emit('new tweet', newTweet);
  console.log("Tweet saved:", newTweet);
  return res.json({ success: true, tweet: newTweet });
});

app.post('/api/tweet/reply', (req, res) => {
  const { tweetId, handle, text, imageData } = req.body;
  if (!tweetId || !handle || !text) return res.status(400).json({ success: false, error: "Tweet ID, handle, and reply text required" });
  const tweet = tweets.find(t => t.id === tweetId);
  if (!tweet) return res.status(404).json({ success: false, error: "Tweet not found" });
  const user = users[handle.toLowerCase()];
  if (user.banned) return res.status(403).json({ success: false, error: "Account suspended" });
  const newReply = {
    id: Date.now(),
    handle,
    text,
    imageData: imageData || null,
    timestamp: Date.now(),
    likes: 0,
    profilePicture: user?.profilePicture || null,
    verified: user?.verified || null
  };
  tweet.replies.push(newReply);
  io.emit('new reply', { tweetId, reply: newReply });
  return res.json({ success: true, reply: newReply });
});

app.post('/api/tweet/retweet', (req, res) => {
  const { tweetId, handle } = req.body;
  if (!tweetId || !handle) return res.status(400).json({ success: false, error: "Tweet ID and handle required" });
  const tweet = tweets.find(t => t.id === tweetId);
  if (!tweet) return res.status(404).json({ success: false, error: "Tweet not found" });
  const user = users[handle.toLowerCase()];
  if (user.banned) return res.status(403).json({ success: false, error: "Account suspended" });
  tweet.timestamp = Date.now();
  tweet.last_retweeted_by = handle;
  io.emit('tweet retweeted', tweet);
  return res.json({ success: true, tweet });
});

app.patch('/api/tweet/poll/vote', (req, res) => {
  const { id, option } = req.body;
  const tweet = tweets.find(t => t.id === id);
  if (!tweet || !tweet.poll) return res.status(404).json({ success: false, error: "Tweet or poll not found" });
  const pollOption = tweet.poll.options.find(opt => opt.text === option);
  if (!pollOption) return res.status(400).json({ success: false, error: "Option not found" });
  pollOption.votes += 1;
  io.emit('poll voted', tweet);
  return res.json({ success: true, tweet });
});

app.get('/api/tweets', (req, res) => {
  const enrichedTweets = tweets.map(tweet => ({
    ...tweet,
    profilePicture: users[tweet.handle.toLowerCase()]?.profilePicture || null,
    verified: users[tweet.handle.toLowerCase()]?.verified || null,
    replies: tweet.replies.map(reply => ({
      ...reply,
      profilePicture: users[reply.handle.toLowerCase()]?.profilePicture || null,
      verified: users[reply.handle.toLowerCase()]?.verified || null
    })),
    quotedTweet: tweet.quotedTweet ? {
      ...tweet.quotedTweet,
      profilePicture: users[tweet.quotedTweet.handle.toLowerCase()]?.profilePicture || null,
      verified: users[tweet.quotedTweet.handle.toLowerCase()]?.verified || null
    } : null
  }));
  const sortedTweets = enrichedTweets.sort((a, b) => b.timestamp - a.timestamp);
  res.json({ tweets: sortedTweets });
});

app.patch('/api/tweet/like', (req, res) => {
  const { id, likes } = req.body;
  const tweet = tweets.find(t => t.id === id);
  if (!tweet) return res.status(404).json({ success: false, error: "Tweet not found" });
  tweet.likes = likes;
  io.emit('tweet liked', tweet);
  return res.json({ success: true, tweet });
});

app.patch('/api/tweet/reply/like', (req, res) => {
  const { tweetId, replyId, likes } = req.body;
  const tweet = tweets.find(t => t.id === tweetId);
  if (!tweet) return res.status(404).json({ success: false, error: "Tweet not found" });
  const reply = tweet.replies.find(r => r.id === replyId);
  if (!reply) return res.status(404).json({ success: false, error: "Reply not found" });
  reply.likes = likes;
  io.emit('reply liked', { tweetId, reply });
  return res.json({ success: true, reply });
});

app.get('/api/profile', (req, res) => {
  const { handle } = req.query;
  if (!handle) return res.status(400).json({ success: false, error: "Handle parameter is required" });
  const user = users[handle.toLowerCase()];
  if (!user) return res.status(404).json({ success: false, error: "User not found" });
  return res.json({ success: true, profile: { handle: user.handle, bio: user.bio || "", profilePicture: user.profilePicture || null, verified: user.verified || null } });
});

app.patch('/api/profile', (req, res) => {
  const { handle, bio, profilePicture, verified } = req.body;
  if (!handle) return res.status(400).json({ success: false, error: "Handle is required" });
  const user = users[handle.toLowerCase()];
  if (!user) return res.status(404).json({ success: false, error: "User not found" });
  if (bio !== undefined) user.bio = bio;
  if (profilePicture !== undefined) user.profilePicture = profilePicture;
  if (verified !== undefined) user.verified = verified;
  return res.json({ success: true, message: "Profile updated", profile: { handle: user.handle, bio: user.bio, profilePicture: user.profilePicture, verified: user.verified } });
});

app.get('/api/users', (req, res) => {
  const userList = Object.values(users).map(user => ({
    handle: user.handle,
    password: user.password,
    banned: user.banned
  }));
  res.json({ success: true, users: userList });
});

app.post('/api/ban', (req, res) => {
  const { handle } = req.body;
  if (!handle) return res.status(400).json({ success: false, error: "Handle is required" });
  const user = users[handle.toLowerCase()];
  if (!user) return res.status(404).json({ success: false, error: "User not found" });
  user.banned = true;
  return res.json({ success: true, message: "User banned" });
});

app.get('/api/trending', (req, res) => {
  const hashtagCount = {};
  tweets.forEach(tweet => {
    const hashtags = tweet.text.match(/#([a-zA-Z0-9]+)/g) || [];
    hashtags.forEach(tag => {
      const cleanTag = tag.toLowerCase();
      hashtagCount[cleanTag] = (hashtagCount[cleanTag] || 0) + 1;
    });
  });
  const trending = Object.entries(hashtagCount)
    .filter(([tag, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  res.json({ success: true, trending });
});

// New endpoints for classrooms
app.get('/api/classrooms', (req, res) => {
  res.json({ success: true, classrooms });
});

app.post('/api/classrooms', (req, res) => {
  const { name, instructor } = req.body;
  if (!name || !instructor) {
    return res.status(400).json({ success: false, error: "Class name and instructor required" });
  }
  const newClassroom = {
    id: Date.now(),
    name,
    instructor,
    timestamp: Date.now()
  };
  classrooms.push(newClassroom);
  io.emit('new classroom', newClassroom); // Real-time update for all clients
  saveData(); // Save to classrooms.json immediately
  return res.json({ success: true, classroom: newClassroom });
});

app.post('/api/announcements', (req, res) => {
    const { classId, text, author, authorRole } = req.body;
    if (!classId || !text || !author) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const newAnnouncement = {
        id: Date.now().toString(),
        classId,
        text,
        author,
        authorRole,
        timestamp: Date.now()
    };

    announcements.push(newAnnouncement);
    io.emit('new announcement', newAnnouncement);
    saveData();
    return res.json({ success: true, announcement: newAnnouncement });
});

app.get('/api/announcements/:classId', (req, res) => {
    const { classId } = req.params;
    const classAnnouncements = announcements
        .filter(a => a.classId === classId)
        .sort((a, b) => b.timestamp - a.timestamp);
    return res.json({ success: true, announcements: classAnnouncements });
});

app.delete('/api/announcements/:id', (req, res) => {
    const { id } = req.params;
    const index = announcements.findIndex(a => a.id === id);
    if (index === -1) {
        return res.status(404).json({ success: false, error: "Announcement not found" });
    }
    
    announcements.splice(index, 1);
    io.emit('announcement deleted', id);
    saveData();
    return res.json({ success: true });
});

// Add a tweet to user's bookmarks
app.post('/api/bookmark', (req, res) => {
  const { handle, tweetId } = req.body;
  if (!handle || !tweetId) {
    return res.json({ success: false, error: 'Handle and tweet ID are required' });
  }

  const user = users[handle.toLowerCase()];
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }

  // Initialize bookmarks array if it doesn't exist
  if (!user.bookmarks) {
    user.bookmarks = [];
  }

  // Check if tweet is already bookmarked
  if (user.bookmarks.includes(tweetId)) {
    return res.json({ success: false, error: 'Tweet is already bookmarked' });
  }

  // Add tweet to bookmarks
  user.bookmarks.push(tweetId);
  saveData();
  
  return res.json({ success: true });
});

// Remove a tweet from user's bookmarks
app.delete('/api/bookmark', (req, res) => {
  const { handle, tweetId } = req.body;
  if (!handle || !tweetId) {
    return res.json({ success: false, error: 'Handle and tweet ID are required' });
  }

  const user = users[handle.toLowerCase()];
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }

  // Check if user has bookmarks
  if (!user.bookmarks || !user.bookmarks.includes(tweetId)) {
    return res.json({ success: false, error: 'Tweet is not bookmarked' });
  }

  // Remove tweet from bookmarks
  user.bookmarks = user.bookmarks.filter(id => id !== tweetId);
  saveData();
  
  return res.json({ success: true });
});

// Get user's bookmarked tweets
app.get('/api/bookmarks', (req, res) => {
  const handle = req.query.handle;
  if (!handle) {
    return res.json({ success: false, error: 'Handle is required' });
  }

  const user = users[handle.toLowerCase()];
  if (!user) {
    return res.json({ success: false, error: 'User not found' });
  }

  // If user has no bookmarks, return empty array
  if (!user.bookmarks || user.bookmarks.length === 0) {
    return res.json({ success: true, bookmarks: [] });
  }

  // Get all bookmarked tweets
  const bookmarkedTweets = tweets.filter(tweet => user.bookmarks.includes(tweet.id));
  
  return res.json({ success: true, bookmarks: bookmarkedTweets });
});

// Handle process signals for graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT, saving data...');
  await saveData();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, saving data...');
  await saveData();
  process.exit(0);
});

// Start the server
http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});