export const generateSummary = (data) => {
    if (!data || data.length === 0) return {};

    let totalCost = 0;
    let siteMap = {};
    let maxSite = { site: null, cost: 0 };

    data.forEach(row => {
        const site = row["Site Code"] || row["site"];
        const cost = Number(row["Total Cost"] || 0);

        totalCost += cost;

        if (!siteMap[site]) siteMap[site] = 0;
        siteMap[site] += cost;

        if (siteMap[site] > maxSite.cost) {
            maxSite = { site, cost: siteMap[site] };
        }
    });

    return {
        totalCost,
        totalSites: Object.keys(siteMap).length,
        highestSpendingSite: maxSite,
    };
};