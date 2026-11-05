param([Parameter(Mandatory=$true)][string]$InputFile,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
# Only local numeric conversion uses the old OCI library. There is no database
# connection here. ASCII numeric conversion needs no external Arabic NLS files.
$env:ORACLE_HOME='C:\OraNT'
$env:PATH='C:\OraNT\Bin;'+$env:PATH
$env:NLS_LANG='AMERICAN_AMERICA.US7ASCII'
Add-Type -AssemblyName System.Web.Extensions
Add-Type -ReferencedAssemblies System.Web.Extensions -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Globalization;
using System.Collections;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Web.Script.Serialization;
public static class LegacyMovementJsonCsv {
  [DllImport("oci.dll",CallingConvention=CallingConvention.Cdecl)]static extern int OCIInitialize(uint m,IntPtr c,IntPtr a,IntPtr r,IntPtr f);
  [DllImport("oci.dll",CallingConvention=CallingConvention.Cdecl)]static extern int OCIEnvInit(out IntPtr env,uint m,UIntPtr x,IntPtr u);
  [DllImport("oci.dll",CallingConvention=CallingConvention.Cdecl)]static extern int OCIHandleAlloc(IntPtr env,out IntPtr h,uint t,UIntPtr x,IntPtr u);
  [DllImport("oci.dll",CallingConvention=CallingConvention.Cdecl)]static extern int OCIHandleFree(IntPtr h,uint t);
  [DllImport("oci.dll",CallingConvention=CallingConvention.Cdecl)]static extern int OCINumberFromText(IntPtr e,byte[] s,uint len,byte[] fmt,uint flen,byte[] nls,uint nlen,byte[] num);
  [DllImport("oci.dll",CallingConvention=CallingConvention.Cdecl)]static extern int OCINumberToReal(IntPtr e,byte[] num,uint len,out double v);
  private static IntPtr environment, error;
  private static void Check(int code) { if (code != 0) throw new InvalidDataException("Legacy numeric conversion failed: " + code); }
  private static string LegacyDouble(string text) {
    if (environment == IntPtr.Zero) {
      Check(OCIInitialize(2,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero));
      Check(OCIEnvInit(out environment,0,UIntPtr.Zero,IntPtr.Zero));
      Check(OCIHandleAlloc(environment,out error,2,UIntPtr.Zero,IntPtr.Zero));
    }
    bool negative = text.StartsWith("-");
    text = text.TrimStart('-','+');
    int exponentIndex = text.IndexOfAny(new char[] {'E','e'});
    if (exponentIndex >= 0) {
      int exponent = Int32.Parse(text.Substring(exponentIndex+1),CultureInfo.InvariantCulture);
      string mantissa = text.Substring(0,exponentIndex);
      int point = mantissa.IndexOf('.'); if (point < 0) point = mantissa.Length;
      string digits = mantissa.Replace(".",""); point += exponent;
      text = point <= 0 ? "0."+new string('0',-point)+digits : point >= digits.Length ? digits+new string('0',point-digits.Length) : digits.Insert(point,".");
    }
    var format = new StringBuilder();
    foreach (char c in text) format.Append(c == '.' ? 'D' : '9');
    byte[] input = Encoding.ASCII.GetBytes(text), fmt = Encoding.ASCII.GetBytes(format.ToString());
    byte[] nls = Encoding.ASCII.GetBytes("NLS_NUMERIC_CHARACTERS='.,'"), number = new byte[22];
    Check(OCINumberFromText(error,input,(uint)input.Length,fmt,(uint)fmt.Length,nls,(uint)nls.Length,number));
    double result; Check(OCINumberToReal(error,number,8,out result));
    return (negative ? -result : result).ToString(CultureInfo.InvariantCulture);
  }
  public static void ConvertFile(string input, string output) {
    var serializer = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };
    var root = serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(input, Encoding.UTF8));
    var columns = (IList) root["columns"];
    var types = (IList) root["types"];
    var rows = (IList) root["rows"];
    using (var writer = new StreamWriter(output, false, new UTF8Encoding(false))) {
      WriteRow(writer, columns);
      foreach (IList row in rows) {
        var values = new object[row.Count];
        for (int i=0;i<row.Count;i++) {
          if (row[i] == null) { values[i] = ""; continue; }
          string text = (string)row[i];
          int type = System.Convert.ToInt32(types[i]);
          if (type == 5) values[i] = LegacyDouble(text);
          else if (type == 131 || type == 139) {
            decimal value;
            // MSDAORA exposes integer/NUMBER expressions as Decimal, returning DBNull for values
            // outside Decimal's range. Retain its historical CSV contract.
            values[i] = Decimal.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out value) ? value.ToString(CultureInfo.InvariantCulture) : "";
          } else if (type == 200) values[i] = text;
          else throw new InvalidDataException("Unsupported legacy movement type");
        }
        WriteRow(writer, values);
      }
    }
    if (error != IntPtr.Zero) { OCIHandleFree(error,2); error = IntPtr.Zero; }
    if (environment != IntPtr.Zero) { OCIHandleFree(environment,1); environment = IntPtr.Zero; }
  }
  private static void WriteRow(TextWriter writer, IList values) {
    for (int i=0;i<values.Count;i++) {
      if (i>0) writer.Write(',');
      writer.Write('"'); writer.Write(System.Convert.ToString(values[i], CultureInfo.InvariantCulture).Replace("\"", "\"\"")); writer.Write('"');
    }
    writer.WriteLine();
  }
}
'@
[LegacyMovementJsonCsv]::ConvertFile($InputFile,$OutputFile)
