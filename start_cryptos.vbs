Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "C:\Inetpub\cryptos-main\start_node.bat" & Chr(34), 0
Set WshShell = Nothing
