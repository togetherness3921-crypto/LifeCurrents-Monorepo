Set WshShell = CreateObject("WScript.Shell")
' Change to the correct directory and run the bat file
WshShell.CurrentDirectory = "C:\LifeCurrents\packages\dashboard-py"
WshShell.Run "cmd.exe /k ""cd /d C:\LifeCurrents\packages\dashboard-py && python main.py""", 1, False
Set WshShell = Nothing

