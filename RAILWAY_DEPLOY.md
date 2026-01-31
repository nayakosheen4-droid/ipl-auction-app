# 🚂 Railway.app Deployment Checklist

## ✅ Pre-Deployment (Already Done!)
- [x] Code is working locally
- [x] Git repository initialized
- [x] All files committed
- [x] Deployment config files added (Procfile, railway.json)
- [x] Environment variables configured

## 📤 Step 1: Push to GitHub

1. Go to https://github.com/new
2. Create repo: `ipl-auction-app` (public)
3. Run these commands (replace YOUR_USERNAME):

```bash
cd /Users/onayak/Desktop/ipl-app
git remote add origin https://github.com/YOUR_USERNAME/ipl-auction-app.git
git branch -M main
git push -u origin main
```

## 🚀 Step 2: Deploy on Railway

1. **Visit**: https://railway.app
2. **Click**: "Login" (top right)
3. **Sign in**: With your GitHub account
4. **Authorize**: Railway to access your repos
5. **Click**: "New Project" (or "+ New Project")
6. **Select**: "Deploy from GitHub repo"
7. **Choose**: `ipl-auction-app` from the list
8. **Wait**: Railway auto-detects Node.js and starts deploying (~2 mins)

## 🌐 Step 3: Get Your URL

1. In Railway dashboard, you'll see your project
2. Go to the **Settings** tab
3. Scroll to **Domains** section
4. **Click**: "Generate Domain"
5. You'll get a URL like: `ipl-auction-app-production.up.railway.app`

## 🔗 Step 4: Share!

Copy your Railway URL and share it:
- Format: `https://your-app-name.up.railway.app`
- Send to friends
- They can access from anywhere!

## 🎮 Step 5: Test Your Deployed App

1. Open the Railway URL in your browser
2. Login as Admin: `admin2024`
3. Test selling a player
4. Open in another browser/incognito
5. Login as a team and verify everything works!

## 🔧 Troubleshooting

### If deployment fails:

**Check Railway Logs:**
1. Go to your project in Railway
2. Click on your service
3. Click "Deployments" tab
4. Click on the latest deployment
5. Check the build and runtime logs

**Common issues:**
- **Build fails**: Check if all dependencies are in package.json
- **App crashes**: Check runtime logs for errors
- **Can't connect**: Wait 30 seconds after first deploy

### To update your app later:

```bash
# Make changes to your code
git add .
git commit -m "Your update message"
git push

# Railway auto-deploys on every push!
```

## 💰 Railway Free Tier

- **$5 credit per month** (auto-renews)
- **~500 hours** of runtime (enough for active development)
- **No credit card required** initially
- **Persistent storage** for Excel file
- **Custom domain** support

## 🎯 What Users Will Need

Just send them:
1. The Railway URL
2. Team passwords (from README.md)

That's it! No installation needed on their end.

## 📊 Monitor Your App

**In Railway Dashboard:**
- View real-time logs
- Check CPU/memory usage
- See active connections
- Monitor deployment status
- View environment variables

**Metrics Tab shows:**
- Request count
- Response times
- Active WebSocket connections
- Memory usage

---

**Need help?** Railway has excellent documentation at https://docs.railway.app

