# Railway Volume Setup for Persistent Storage

## Problem
Railway's filesystem is **ephemeral**, meaning all files are deleted when the app redeploys. This causes sold players to become available again because the Excel file is lost.

## Solution: Add a Persistent Volume

### Steps to Add Volume on Railway:

1. **Go to your Railway project dashboard**
   - Navigate to https://railway.app
   - Select your `ipl-auction-app` project

2. **Open the Service**
   - Click on your Node.js service

3. **Add a Volume**
   - Go to the **"Settings"** tab
   - Scroll down to **"Volumes"** section
   - Click **"New Volume"**

4. **Configure the Volume**
   - **Mount Path**: `/app/data`
   - **Name**: `auction-data` (or any name you prefer)
   - Click **"Add"**

5. **Redeploy**
   - After adding the volume, trigger a redeploy
   - The Excel file will now persist across deployments!

### How It Works
- The volume is mounted at `/app/data`
- Your `auction_data.xlsx` file is stored at `/app/data/auction_data.xlsx`
- This directory persists across deployments, server restarts, and updates
- All sold players, team budgets, and RTM status are preserved

### Verify It's Working
1. Sell a player (e.g., Bumrah to Mumbai Indians)
2. Trigger a redeploy (or wait for auto-deploy)
3. Log in again - Bumrah should still be sold to MI
4. Check team budgets - they should reflect previous purchases

### Important Notes
- **Free Tier**: Railway free tier includes 5GB of volume storage
- **Backup**: Consider backing up your Excel file regularly
- **Migration**: If you ever change the mount path, you'll need to migrate data

### Alternative: Database Solution
If you want a more robust solution, consider migrating from Excel to PostgreSQL:
- Railway offers managed PostgreSQL databases
- Better for concurrent access and reliability
- Easier to scale for multiple simultaneous auctions

