import * as XLSX from 'xlsx';

/**
 * Exports data to an Excel file.
 * @param {Array<Object>} data - The data rows to export.
 * @param {string} fileName - The name of the Excel file.
 * @param {string} sheetName - The name of the sheet.
 */
export const exportToExcel = (data, fileName = 'iBill_Audit_Export.xlsx', sheetName = 'Audit Data') => {
    try {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, fileName);
    } catch (error) {
        console.error('Failed to export Excel:', error);
    }
};

/**
 * Specialized export for the Unified Comparison Ledger.
 * @param {Array<Object>} unifiedData - The unified data from DetailedComparison.
 * @param {string} nameA - Name of Invoice A.
 * @param {string} nameB - Name of Invoice B.
 * @param {Array<string>} extraFields - Additional metadata fields.
 */
export const exportComparisonToExcel = (unifiedData, nameA, nameB, extraFields = []) => {
    try {
        const exportRows = unifiedData.map((item) => {
            const row = {
                'Site ID': item.siteId,
                'Region': item.dataA?.region || item.dataB?.region || '-'
            };

            // Metadata/Extra Fields
            extraFields.forEach(f => {
                row[`[A] ${f}`] = item.dataA?.extras[f] ?? '-';
                row[`[B] ${f}`] = item.dataB?.extras[f] ?? '-';
            });

            // Financials - Period A
            row[`[A] Non-Energy`] = item.dataA?.ne || 0;
            row[`[A] Energy`] = item.dataA?.energy || 0;
            row[`[A] Amendment`] = item.dataA?.amd || 0;
            row[`[A] Total Billed`] = item.dataA?.total || 0;

            // Financials - Period B
            row[`[B] Non-Energy`] = item.dataB?.ne || 0;
            row[`[B] Energy`] = item.dataB?.energy || 0;
            row[`[B] Amendment`] = item.dataB?.amd || 0;
            row[`[B] Total Billed`] = item.dataB?.total || 0;

            // Variance
            row['Net Variance'] = item.variance;
            row['Variance %'] = (item.dataA?.total ? (item.variance / item.dataA.total) * 100 : 0).toFixed(2) + '%';

            return row;
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportRows);
        
        // Adjust column widths for readability
        const wscols = [
            { wch: 15 }, // Site ID
            { wch: 15 }, // Region
        ];
        // Add padding for other columns
        for(let i=2; i<Object.keys(exportRows[0]).length; i++) wscols.push({ wch: 18 });
        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, 'Variance Ledger');
        const fileName = `iBill_Comparison_${nameA.substring(0, 10)}_vs_${nameB.substring(0, 10)}.xlsx`;
        XLSX.writeFile(wb, fileName);
    } catch (error) {
        console.error('Failed to export comparison excel:', error);
    }
};
