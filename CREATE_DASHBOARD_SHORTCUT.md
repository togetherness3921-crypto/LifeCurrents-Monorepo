# Creating a Separate Taskbar Shortcut for Dashboard

## Problem
Windows groups all CMD.exe windows under the same taskbar icon, even when they launch different applications.

## Solution: VBS Launcher + Custom Shortcut

### Step 1: VBS Launcher Created
✅ I've created `start-dashboard-launcher.vbs` in the root directory.

### Step 2: Create a Windows Shortcut

1. **Right-click on your Desktop** → New → Shortcut

2. **Enter the location:**
   ```
   C:\LifeCurrents\start-dashboard-launcher.vbs
   ```
   Click "Next"

3. **Name it:**
   ```
   LifeCurrents Dashboard
   ```
   Click "Finish"

### Step 3: Customize the Shortcut

1. **Right-click the shortcut** → Properties

2. **Change Icon (optional):**
   - Click "Change Icon..."
   - Browse to: `C:\Windows\System32\shell32.dll`
   - Pick an icon you like (Python icon, terminal icon, etc.)
   - Click OK

3. **Set Start In:**
   - In "Start in:" field, enter: `C:\LifeCurrents\packages\dashboard-py`

4. Click "OK" to save

### Step 4: Pin to Taskbar

1. **Run the shortcut once** from Desktop (to test it works)
2. **Right-click the Desktop shortcut** → "Pin to taskbar"
3. **Done!** It will now have its own separate taskbar icon

### Step 5: For Your Other App (Streamer)

To separate your existing streamer app, do the same:

1. Create `start-streamer-launcher.vbs`:
   ```vbs
   Set WshShell = CreateObject("WScript.Shell")
   WshShell.Run "cmd.exe /k ""cd /d C:\path\to\streamer && streamer.bat""", 1, False
   Set WshShell = Nothing
   ```

2. Create shortcut to it
3. Pin that shortcut instead

This way, each app will have its own independent taskbar presence!

## Alternative: Direct BAT File Shortcut (Simpler but shows CMD window)

If you don't mind seeing the CMD window:

1. **Right-click Desktop** → New → Shortcut
2. **Target:** `C:\LifeCurrents\packages\dashboard-py\start-dashboard.bat`
3. **Name:** "LifeCurrents Dashboard"
4. **Properties** → Change Icon (pick something recognizable)
5. **Pin to Taskbar**

The VBS method is cleaner because:
- Each app gets its own taskbar icon
- No CMD window grouping issues
- Professional appearance

## Quick Test

Run the VBS file by double-clicking `start-dashboard-launcher.vbs` - you should see the dashboard start in a CMD window. If it works, proceed with pinning to taskbar!

