import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * Exports a DOM element to a professional PDF report.
 * @param {string} elementId - The ID of the element to export.
 * @param {string} fileName - The name of the PDF file.
 * @param {Object} options - Additional info like reportTitle, subtitle.
 */
export const exportToPDF = async (elementId, fileName = 'iBill_Audit_Report.pdf', options = {}) => {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`Element with id ${elementId} not found`);
        return;
    }

    try {
        const { reportTitle = 'Forensic Audit Report', subtitle = '' } = options;

        // Create a temporary wrapper for the "Professional Report" style
        const wrapper = document.createElement('div');
        wrapper.style.position = 'absolute';
        wrapper.style.top = '-9999px';
        wrapper.style.left = '-9999px';
        wrapper.style.width = '1200px'; // Consistent width for PDF
        wrapper.style.padding = '40px';
        wrapper.style.background = '#ffffff'; // White background for professional look
        wrapper.style.color = '#1e293b'; // Slate 800 for text
        wrapper.style.fontFamily = "'Inter', sans-serif";
        
        // Add Header
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '40px';
        header.style.borderBottom = '2px solid #6366f1';
        header.style.paddingBottom = '20px';
        
        header.innerHTML = `
            <div>
                <div style="font-size: 24px; font-weight: 900; color: #6366f1; letter-spacing: -1px;">IBILL AI ASSISTANT</div>
                <div style="font-size: 14px; color: #64748b; font-weight: 600; text-transform: uppercase; margin-top: 4px;">Forensic Audit Intelligence Engine</div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 18px; font-weight: 800; color: #1e293b;">${reportTitle}</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Generated on: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
            </div>
        `;
        
        wrapper.appendChild(header);

        // Clone the content
        const clone = element.cloneNode(true);
        
        // --- CLEAN UP THE CLONE ---
        // Hide all buttons
        const buttons = clone.querySelectorAll('button');
        buttons.forEach(btn => btn.style.display = 'none');
        
        // Hide dismissal/back links
        const dismissLinks = clone.querySelectorAll('a, button');
        dismissLinks.forEach(link => {
            if (link.textContent.toLowerCase().includes('dismiss') || link.textContent.toLowerCase().includes('back') || link.textContent.toLowerCase().includes('reset')) {
                link.style.display = 'none';
            }
        });

        // Convert dark panel styles to light/professional styles
        const glassPanels = clone.querySelectorAll('.glass-panel');
        glassPanels.forEach(panel => {
            panel.style.background = '#ffffff';
            panel.style.border = '1px solid #e2e8f0';
            panel.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            panel.style.color = '#1e293b';
            panel.style.backdropFilter = 'none';
            panel.style.padding = '24px';
            panel.style.marginBottom = '20px';
        });

        const metricCards = clone.querySelectorAll('.metric-card');
        metricCards.forEach(card => {
            card.style.borderLeft = '4px solid #6366f1';
        });

        // Handle specific components that might have inline styles
        const textDim = clone.querySelectorAll('[style*="color: var(--text-dim)"], [style*="color: #94a3b8"]');
        textDim.forEach(el => el.style.color = '#64748b');

        const textMain = clone.querySelectorAll('[style*="color: var(--text-main)"], [style*="color: #f8fafc"]');
        textMain.forEach(el => el.style.color = '#1e293b');

        const values = clone.querySelectorAll('.metric-value');
        values.forEach(v => {
            v.style.color = '#1e293b';
            v.style.fontSize = '2.5rem';
        });

        // Adjust summaries (innerHTML blocks)
        const summaryContainers = clone.querySelectorAll('[dangerouslySetInnerHTML], .summary-container, [style*="white-space: pre-wrap"]');
        summaryContainers.forEach(container => {
            container.style.color = '#334155';
            container.style.background = '#ffffff';
            container.style.lineHeight = '1.7';
            container.style.fontSize = '14px';
            
            const internalTitles = container.querySelectorAll('h3');
            internalTitles.forEach(t => {
                t.style.color = '#4f46e5';
                t.style.marginTop = '24px';
                t.style.borderBottom = '1px solid #f1f5f9';
                t.style.paddingBottom = '8px';
            });
        });

        // Ensure tables look good
        const tables = clone.querySelectorAll('table');
        tables.forEach(table => {
            table.style.color = '#334155';
            table.style.background = '#ffffff';
            table.style.borderCollapse = 'collapse';
            const ths = table.querySelectorAll('th');
            ths.forEach(th => {
                th.style.background = '#f8fafc';
                th.style.color = '#475569';
                th.style.borderBottom = '2px solid #e2e8f0';
                th.style.padding = '12px';
                th.style.fontSize = '12px';
            });
            const tds = table.querySelectorAll('td');
            tds.forEach(td => {
                td.style.borderBottom = '1px solid #f1f5f9';
                td.style.color = '#1e293b';
                td.style.padding = '12px';
                td.style.fontSize = '12px';
            });
        });

        wrapper.appendChild(clone);
        
        // Add Footer
        const footer = document.createElement('div');
        footer.style.marginTop = '40px';
        footer.style.paddingTop = '20px';
        footer.style.borderTop = '1px solid #e2e8f0';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'space-between';
        footer.style.fontSize = '11px';
        footer.style.color = '#94a3b8';
        footer.innerHTML = `
            <div>IBILL FORENSIC AUDIT ENGINE • CONFIDENTIAL</div>
            <div>© ${new Date().getFullYear()} iBill AI Assistant</div>
        `;
        wrapper.appendChild(footer);

        document.body.appendChild(wrapper);

        // Capture the wrapper
        const canvas = await html2canvas(wrapper, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff'
        });

        document.body.removeChild(wrapper);

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({
            orientation: 'p',
            unit: 'px',
            format: [canvas.width, canvas.height]
        });

        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save(fileName);
    } catch (error) {
        console.error('Failed to export professional PDF:', error);
    }
};
