const express = require('express');
const { spawn } = require('child_process');
const fetch = require('node-fetch');
const app = express();
const PORT = 3000;

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.post('/admin/shutdown', (req, res) => {
  res.send('Shutting down...');
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

const users = {};
const tweets = [];

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

app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send("URL parameter is required");
  }
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });
    if (!response.ok) {
      return res.status(response.status).send(`Error fetching URL: ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "text/html";
    res.set("Content-Type", contentType);
    response.body.pipe(res); // streams the stuff back to server
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Error fetching the requested URL");
  }
});

http.listen(3000, '0.0.0.0', () => {
  console.log('Server running on port 3000');
});

http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});