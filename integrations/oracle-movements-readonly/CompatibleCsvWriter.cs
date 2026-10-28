using System;
using System.Globalization;
using System.IO;
using System.Text;

// Preserve the established .NET Framework/ADO value types and CSV formatting.
// Bulk GetRows avoids millions of cross-COM Field.Value calls.
public static class AlbinaaCompatibleMovementCsv
{
    public static int WriteRows(object[,] rows, TextWriter writer)
    {
        int columns = rows.GetLength(0), count = rows.GetLength(1);
        for (int r = rows.GetLowerBound(1); r < rows.GetLowerBound(1) + count; r++)
        {
            var line = new StringBuilder();
            for (int c = rows.GetLowerBound(0); c < rows.GetLowerBound(0) + columns; c++)
            {
                if (c != rows.GetLowerBound(0)) line.Append(',');
                object value = rows[c, r];
                string text = value == null || value == DBNull.Value ? "" : Convert.ToString(value, CultureInfo.InvariantCulture);
                line.Append('"').Append(text.Replace("\"", "\"\"")).Append('"');
            }
            writer.WriteLine(line.ToString());
        }
        return count;
    }
}
