export class JobMatcher {
  constructor(profile, criteria) {
    this.profile = profile;
    this.criteria = criteria;

    this.coreKeywords = [
      'supply chain', 'demand planning', 'inventory planning', 'inventory analyst',
      'procurement', 'purchasing', 'logistics', 's&op', 'reorder', 'inbound',
      'forecast', 'vendor management', 'supplier', 'erp', 'sap', 'excel',
      'sql', 'power bi', 'tableau', '3pl', 'sku', 'bom', 'materials management'
    ];

    this.defaultNegativeKeywords = [
      'geomatics', 'surveying', 'surveyor', 'gis', 'nurse', 'nursing',
      'medical', 'clinical', 'physician', 'dental', 'pharmacy', 'therapist',
      'restaurant', 'culinary', 'chef', 'cook', 'bartender', 'barista', 'server',
      'construction superintendent', 'plumber', 'electrician', 'hvac', 'carpenter',
      'real estate', 'property manager', 'leasing agent',
      'attorney', 'paralegal', 'legal assistant', 'lawyer',
      'software engineer', 'frontend developer', 'backend developer', 'devops',
      'unpaid', 'volunteer'
    ];
  }

  evaluate(job) {
    const title = (job.title || '').toLowerCase();
    const description = (job.description || '').toLowerCase();
    const company = (job.company || '').toLowerCase();
    const fullText = `${title} ${description} ${company}`;

    // 1. Check blacklist companies
    for (const blacklisted of (this.criteria.blacklistCompanies || [])) {
      if (company.includes(blacklisted.toLowerCase())) {
        return {
          eligible: false,
          score: 0,
          reason: `Company '${job.company}' is in blacklist`
        };
      }
    }

    // 2. Check negative keywords (both user-configured and default domain exclusions)
    const allNegativeKeywords = [
      ...(this.criteria.negativeKeywords || []),
      ...this.defaultNegativeKeywords
    ];

    for (const neg of allNegativeKeywords) {
      if (title.includes(neg.toLowerCase())) {
        return {
          eligible: false,
          score: 0,
          reason: `Title matched non-target keyword '${neg}'`
        };
      }
    }

    // 3. Match calculation: Title MUST reflect Supply Chain / Procurement / Inventory / Logistics
    let matchedKeywords = [];
    let score = 0;
    let domainMatched = false;

    // Check exact or partial match with user's target titles
    const targetTitles = this.criteria.targetTitles || [];
    for (const t of targetTitles) {
      const tLower = t.toLowerCase().trim();
      if (tLower && (title.includes(tLower) || tLower.includes(title))) {
        score = 65;
        domainMatched = true;
        matchedKeywords.push(`Target Title: ${t}`);
        break;
      }
    }

    // Check core supply chain domain keywords in title
    if (!domainMatched) {
      const supplyChainDomains = [
        'supply chain', 'procurement', 'inventory', 'purchasing', 'buyer',
        'logistics', 'sourcing', 'materials', 'demand planner', 'demand planning',
        's&op', 'fulfillment', 'freight', 'vendor management', 'distribution',
        'warehouse', 'reorder', 'inbound logistics', 'shipping and receiving',
        'inventory control', 'material planner', 'operations analyst', 'contracts specialist'
      ];

      for (const domain of supplyChainDomains) {
        if (title.includes(domain)) {
          score = 60;
          domainMatched = true;
          matchedKeywords.push(`Supply Chain Domain: ${domain}`);
          break;
        }
      }
    }

    // If title has NO supply chain relevance, skip immediately
    if (!domainMatched) {
      return {
        eligible: false,
        score: 0,
        reason: 'Title does not match Supply Chain, Procurement, Buyer, or Inventory domains',
        matchedKeywords: []
      };
    }

    // 4. Keyword hits in full description / card text (+5 points each, up to 100)
    for (const kw of this.coreKeywords) {
      if (fullText.includes(kw)) {
        score += 5;
        matchedKeywords.push(kw);
      }
    }

    score = Math.min(100, Math.round(score));
    const minScore = Math.min(this.criteria.minimumMatchScore || 30, 35);
    const eligible = score >= minScore;

    return {
      eligible,
      score,
      reason: eligible ? 'Met target criteria' : `Score ${score}% below minimum threshold of ${minScore}%`,
      matchedKeywords
    };
  }
}
