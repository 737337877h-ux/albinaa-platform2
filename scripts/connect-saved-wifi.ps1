param([Parameter(Mandatory = $true)][string]$ProfileName)

$source = @'
using System;
using System.Runtime.InteropServices;

public static class SavedWifiConnector {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct WLAN_INTERFACE_INFO {
    public Guid InterfaceGuid;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Description;
    public int State;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct WLAN_CONNECTION_PARAMETERS {
    public int ConnectionMode;
    [MarshalAs(UnmanagedType.LPWStr)] public string Profile;
    public IntPtr Dot11Ssid;
    public IntPtr DesiredBssidList;
    public int BssType;
    public uint Flags;
  }

  [DllImport("wlanapi.dll")]
  private static extern uint WlanOpenHandle(uint clientVersion, IntPtr reserved, out uint negotiatedVersion, out IntPtr clientHandle);
  [DllImport("wlanapi.dll")]
  private static extern uint WlanEnumInterfaces(IntPtr clientHandle, IntPtr reserved, out IntPtr interfaceList);
  [DllImport("wlanapi.dll")]
  private static extern uint WlanConnect(IntPtr clientHandle, ref Guid interfaceGuid, ref WLAN_CONNECTION_PARAMETERS connectionParameters, IntPtr reserved);
  [DllImport("wlanapi.dll")]
  private static extern void WlanFreeMemory(IntPtr memory);
  [DllImport("wlanapi.dll")]
  private static extern uint WlanCloseHandle(IntPtr clientHandle, IntPtr reserved);

  public static uint Connect(string profileName) {
    IntPtr handle;
    uint negotiated;
    uint result = WlanOpenHandle(2, IntPtr.Zero, out negotiated, out handle);
    if (result != 0) return result;
    IntPtr list = IntPtr.Zero;
    try {
      result = WlanEnumInterfaces(handle, IntPtr.Zero, out list);
      if (result != 0) return result;
      int count = Marshal.ReadInt32(list, 0);
      int offset = 8;
      int size = Marshal.SizeOf(typeof(WLAN_INTERFACE_INFO));
      for (int i = 0; i < count; i++) {
        var info = (WLAN_INTERFACE_INFO)Marshal.PtrToStructure(IntPtr.Add(list, offset + i * size), typeof(WLAN_INTERFACE_INFO));
        var parameters = new WLAN_CONNECTION_PARAMETERS {
          ConnectionMode = 0,
          Profile = profileName,
          Dot11Ssid = IntPtr.Zero,
          DesiredBssidList = IntPtr.Zero,
          BssType = 3,
          Flags = 0
        };
        result = WlanConnect(handle, ref info.InterfaceGuid, ref parameters, IntPtr.Zero);
        if (result == 0) return 0;
      }
      return result;
    } finally {
      if (list != IntPtr.Zero) WlanFreeMemory(list);
      WlanCloseHandle(handle, IntPtr.Zero);
    }
  }
}
'@

Add-Type -TypeDefinition $source
$result = [SavedWifiConnector]::Connect($ProfileName)
if ($result -ne 0) { throw "WlanConnect failed with Windows error $result" }
Write-Output "Connection requested for saved Wi-Fi profile: $ProfileName"
