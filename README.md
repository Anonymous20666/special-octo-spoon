# Omega v5 - Advanced WhatsApp Bot

A powerful WhatsApp bot with AI capabilities, sticker generation, and advanced features.

## 🌟 Features

### 🤖 AI Capabilities
- **Smart Conversations** - Natural language processing with memory
- **Voice-to-Voice** - Responds to voice notes with voice notes
- **Image Analysis** - Understands and describes images
- **Sticker Generation** - Creates anime/aesthetic stickers on demand
- **Multi-language Support** - Responds in the same language as the user

### 🎨 Media Features
- **Sticker Creation** - Convert images/videos to stickers (`.sticker` or `.s`)
- **AI Sticker Replies** - Automatically responds to stickers with anime/aura stickers
- **Image Generation** - Create images from text descriptions
- **Video Search** - Find and send videos
- **Music Player** - Play songs from YouTube

### 📢 Broadcasting
- **Group Status** - Post to multiple group statuses (`.godcast`)
- **Normal Broadcast** - Send messages to multiple chats (`.gcast`)
- **Link Previews** - Rich link previews with thumbnails
- **Ghost Protocol** - Anti-ban warmup system

### 🛡️ Admin Tools
- **Anti-link** - Block links in groups
- **Anti-bot** - Prevent other bots
- **Anti-spam** - Rate limiting
- **Anti-channel** - Block channel forwards
- **Promote/Demote** - Manage admins
- **Kick/Warn** - Moderation tools

### 🎯 Other Features
- **Multi-session** - Run multiple WhatsApp accounts
- **Redis Caching** - Fast performance
- **MongoDB Storage** - Persistent data
- **Rate Limiting** - Prevent spam
- **Sticker Triggers** - Bind commands to stickers

## 📦 Installation

### Prerequisites
- Node.js 18+
- Redis
- MongoDB
- FFmpeg
- Git

### Setup

1. Clone the repository:
```bash
git clone https://github.com/Anonymous20666/special-octo-spoon.git
cd special-octo-spoon
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```env
TG_BOT_TOKEN=your_telegram_bot_token
OWNER_TG_ID=your_telegram_id
OWNER_WA_JID=your_whatsapp_jid
QWEN_API_KEY=your_qwen_api_key
REDIS_HOST=your_redis_host
REDIS_PORT=10250
REDIS_PASSWORD=your_redis_password
MONGODB_URI=your_mongodb_uri
```

4. Start the bot:
```bash
npm start
# or with PM2
pm2 start index.js --name omega-v5
```

## 🎮 Commands

### General
- `.menu` - Show command menu
- `.sys` - System stats
- `.pappy on/off` - Toggle AI mode

### AI Features
- Send a message (with pappy on) - AI responds
- Send a voice note - AI responds with voice
- Send an image - AI analyzes it
- Send a sticker - AI replies with anime sticker
- "send me a sticker" - AI generates custom sticker

### Media
- `.sticker` or `.s` - Convert image/video to sticker
- `.img [description]` - Generate image
- `.tts [text]` - Text to speech
- `.video [search]` - Search video
- `.play [song]` - Play music

### Broadcasting
- `.gcast [message]` - Broadcast to all chats
- `.godcast [message]` - Post to group statuses
- `.updategstatus [text]` - Update group status

### Admin (Group)
- `.antilink on/off` - Toggle anti-link
- `.antibot on/off` - Toggle anti-bot
- `.antispam on/off` - Toggle anti-spam
- `.kick @user` - Kick member
- `.promote @user` - Promote to admin
- `.demote @user` - Demote from admin
- `.tagall [message]` - Tag all members

### Owner
- `.sudo [number]` - Add sudo user
- `.delsudo [number]` - Remove sudo
- `.bind [command]` - Bind command to sticker

## 🔧 Configuration

Edit `config.js` to customize:
- Global prefix (default: `.`)
- Redis connection
- Task timeout
- Queue concurrency

## 🎨 AI Sticker Themes

The bot generates aesthetic stickers with themes:
- Cool anime characters with glowing aura
- Powerful anime warrior energy
- Aesthetic anime vibes
- Sigma anime character energy
- Legendary anime moments
- Epic anime reactions

## 📝 License

MIT License - Feel free to use and modify

## 🤝 Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

## ⚠️ Disclaimer

This bot is for educational purposes. Use responsibly and follow WhatsApp's Terms of Service.

## 🙏 Credits

Built with:
- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- [Qwen AI](https://dashscope.aliyuncs.com/) - AI capabilities
- [BullMQ](https://github.com/taskforcesh/bullmq) - Queue management
- [Sharp](https://sharp.pixelplumbing.com/) - Image processing

---

Made with ❤️ by Anonymous20666
