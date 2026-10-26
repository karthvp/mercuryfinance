// Render the real, extracted single-file app without changing its CSS or JSX.
// API calls in these canvas-only snapshots never reach the real finance backend.
export function snapshotDocument(html: string, appView = false) {
  const bootstrap = `<script>
    const previewYear = new Date().getFullYear();
    let previewData = {
      currentYear: previewYear,
      initialBalances: {[previewYear]: 5000},
      payrolls: [{id: 1, name: 'Salary', amount: 2800, frequency: 'semimonthly', startDay: 1, dayOfWeek: 5, startYear: previewYear}],
      recurringExpenses: [
        {id: 2, name: 'Rent', amount: 1650, frequency: 'monthly', dayOfMonth: 1, startYear: previewYear},
        {id: 3, name: 'Internet & utilities', amount: 180, frequency: 'monthly', dayOfMonth: 12, startYear: previewYear},
        {id: 4, name: 'Subscriptions', amount: 65, frequency: 'monthly', dayOfMonth: 20, startYear: previewYear}
      ],
      oneOffExpenses: [{id: 5, name: 'Weekend away', amount: 350, date: previewYear + '-11-15'}],
      oneOffIncomes: [], debts: [{id: 6, name: 'Credit card', type: 'credit-card', balance: 4200, apr: 19.9, monthlyPayment: 180, extraPayment: 50}],
      balanceOverrides: {}, archivedYears: []
    };
    window.fetch = async function(input, options) {
      const path = typeof input === 'string' ? input : input.url;
      if (path.includes('/api/auth/user')) return new Response(JSON.stringify({user: ${appView ? "{id: 'design-preview', first_name: 'Alex', last_name: 'Morgan', email: 'preview@example.invalid'}" : 'null'}}), {status: 200, headers: {'Content-Type': 'application/json'}});
      if (path === '/api/data') {
        if (options?.method === 'POST') previewData = {...previewData, ...JSON.parse(options.body)};
        return new Response(JSON.stringify(previewData), {status: 200, headers: {'Content-Type': 'application/json'}});
      }
      if (path.includes('/api/')) return new Response(JSON.stringify({success: true}), {status: 200, headers: {'Content-Type': 'application/json'}});
      throw new Error('Network requests are disabled in this isolated design preview.');
    };
    ${appView ? "window.location.hash = 'app/dashboard';" : ''}
  </script>`;
  return html.replace('<head>', '<head>' + bootstrap);
}

export function DocumentPreview({ html, title, appView = false }: { html: string; title: string; appView?: boolean }) {
  return <iframe title={title} srcDoc={snapshotDocument(html, appView)} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads" style={{display: 'block', width: '100%', height: '100vh', border: 0}} />;
}
