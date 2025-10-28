# Simple Taskbar Shortcut for Dashboard

## The Problem
- VBS files can't be properly pinned to taskbar
- Dragging VBS to taskbar opens "Windows Script Host Settings"
- We need a real Windows shortcut (.lnk file)

## ✅ Simple Solution (Works Every Time)

### Step 1: Create the Shortcut

1. **Right-click on your Desktop** → New → Shortcut

2. **For the location, enter this EXACT command:**
   ```
   C:\Windows\System32\cmd.exe /c "cd /d C:\LifeCurrents\packages\dashboard-py && python main.py"
   ```
   
3. Click **Next**

4. **Name it:** `LifeCurrents Dashboard`

5. Click **Finish**

### Step 2: Customize the Icon (Optional but Recommended)

1. **Right-click the new shortcut** → Properties

2. Click **"Change Icon..."** button

3. Browse to: `C:\Windows\System32\shell32.dll`

4. **Pick an icon you like** (I suggest icon #165 - terminal icon, or #21 - Python-like)

5. Click **OK**, then **OK** again

### Step 3: Pin to Taskbar

1. **Right-click the Desktop shortcut** → **"Pin to taskbar"**

2. **Done!** You now have a permanent taskbar shortcut 🎉

3. You can delete the Desktop shortcut if you want (the taskbar pin stays)

---

## Why This Works

- **cmd.exe** launches with proper AppUserModelID
- **Each shortcut gets its own taskbar icon** (not grouped with other CMD windows)
- **Proper Windows shortcut** can be pinned permanently
- **Custom icon** makes it easy to identify

## For Your Streamer App

Do the same for your streamer:

1. Right-click Desktop → New → Shortcut
2. Location: `C:\Windows\System32\cmd.exe /c "cd /d C:\path\to\streamer && your-streamer-command"`
3. Change icon to something different
4. Pin to taskbar

Now both apps have separate, permanent taskbar icons!

## Alternative: If You Want to Hide the CMD Window

If you want the dashboard to run WITHOUT showing the CMD window, use this location instead:

```
C:\Windows\System32\cmd.exe /c "start /min cmd /c cd /d C:\LifeCurrents\packages\dashboard-py && python main.py"
```

This minimizes the CMD window immediately.

