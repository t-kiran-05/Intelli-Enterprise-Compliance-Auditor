import { NextRequest, NextResponse } from "next/server"
import { checkAuditRateLimit } from "@/lib/ratelimit"
import { GoogleGenAI } from "@google/genai"

const AWS_API_BASE = "https://vbkod6j4wc.execute-api.us-east-1.amazonaws.com"
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xfvaujgocjkczmtxhaym.supabase.co").replace(/\/$/, "")
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  ""

export const GEMINI_AUDIT_SYSTEM_PROMPT = `
You are an expert regulatory compliance auditor, privacy attorney, and risk analyst.

Your task is to perform an INDEPENDENT, MULTI-FRAMEWORK compliance evaluation of the supplied document text against four distinct regulatory frameworks:
1. GDPR (General Data Protection Regulation)
2. SOC 2 (Trust Services Criteria)
3. CCPA / CPRA (California Consumer Privacy Act)
4. ISO/IEC 27701 (Privacy Information Management System)

=============================================================================
CRITICAL EVALUATION MANDATE:
=============================================================================
1. DO NOT assign a single global score across frameworks or mirror scores across frameworks.
2. Every framework score MUST be independently computed from 0 to 100 based strictly on its OWN DISTINCT CRITERIA found in the document text.
3. If a document has strong terms for one framework (e.g., SOC 2 security) but completely lacks required clauses for another (e.g., CCPA Do Not Sell/Share or GDPR DPO info), the scores MUST diverge significantly reflecting the actual evidence in the text.
4. Base your assessment solely on visible evidence in the text. Do not assume or invent missing clauses.

=============================================================================
DISTINCT FRAMEWORK-SPECIFIC CRITERIA:
=============================================================================

[1] GDPR EVALUATION:
- Check for explicit Data Subject Rights (access, rectification, erasure/right to be forgotten, data portability, objection, automated decision-making).
- Check for Lawful Legal Bases under Article 6 (contractual necessity, consent, legitimate interests, compliance with legal obligation).
- Check for Data Protection Officer (DPO) contact information or formal privacy escalation mechanisms.
- Check for EU Cross-Border Data Transfer rules (Standard Contractual Clauses [SCCs], adequacy decisions, BCRs).
- Check for Data Processing Agreement (DPA) Article 28 mandatory terms and 72-hour breach notification (Art. 33/34).

[2] SOC 2 EVALUATION:
- Check for Trust Services Criteria (TSC): Security, Availability, Confidentiality, Processing Integrity, Privacy.
- Check for Logical Access Controls & MFA (CC6.1 / CC6.2, authentication, least privilege access, credential revocation).
- Check for Perimeter Boundary Protection & Encryption in transit and at rest (CC6.6 / CC6.7, TLS 1.2+, AES-256).
- Check for Incident Management & Vulnerability Management (CC7.1 / CC7.2).
- Check for System Availability, Backups, and Disaster Recovery commitments (A1.2, RTO/RPO).

[3] CCPA / CPRA EVALUATION:
- Check for California Consumer Rights (Notice at collection, right to know, right to delete, right to correct, right to limit sensitive personal info).
- Check for Explicit 'Do Not Sell or Share My Personal Information' notices and opt-out mechanisms (§ 1798.120).
- Check for Mandatory Service Provider Contractual Provisions prohibiting selling, sharing, retaining, using, or disclosing personal information outside the direct business relationship (§ 1798.140(ag)).
- Check for Storage Limitation & Purpose Minimization disclosures (§ 1798.145(a)).

[4] ISO/IEC 27701 EVALUATION (PII Controller & Processor Policies):
- Independently evaluate PII Controller and PII Processor lifecycle role definitions, processing boundaries, and privacy governance policies (ISO/IEC 27701 Clause 5.2 / 6.3).
- Check for explicit PII Storage Limitation & Data Retention Schedules (Clause 6.5.2) and secure disposal/destruction policies.
- Check for Temporary File Sanitization and purging procedures (Clause 6.5.4).
- Check for Security Audit Trails, continuous monitoring, and logging of PII access and modifications.
- Check for Subcontractor and Vendor Flow-Down Privacy Governance (Clause 7.4.1).
- Compute and return an independent numeric Iso27701Score (0 to 100) reflecting only these specific ISO 27701 controls found in the text.

=============================================================================
RETURN A STRICT JSON OBJECT WITH THIS EXACT SCHEMA:
=============================================================================
{
  "OverallScore": 82,
  "GdprScore": 85,
  "CcpaScore": 60,
  "Soc2Score": 90,
  "Iso27701Score": 75,
  "overall_score": 82,
  "frameworks": {
    "gdpr": {
      "score": 85,
      "status": "COMPLIANT",
      "summary": "Covers Article 6 legal bases and EU SCC transfer terms with minor gaps in DPO information.",
      "rationale": "Explicit Art. 6 legal basis and EU SCC transfer terms identified. Missing formal DPO contact details."
    },
    "soc2": {
      "score": 90,
      "status": "COMPLIANT",
      "summary": "Strong logical access controls and encryption aligning with Trust Services Criteria.",
      "rationale": "Comprehensive CC6.1 logical access controls and AES-256 encryption at rest are documented."
    },
    "ccpa": {
      "score": 60,
      "status": "NEEDS_REVIEW",
      "summary": "Omits mandatory 'Do Not Sell or Share' notice and service provider prohibitions.",
      "rationale": "Consumer deletion rights are acknowledged, but lacks explicit CCPA § 1798.120 'Do Not Sell or Share' notice and § 1798.140 restrictions."
    },
    "iso27701": {
      "score": 75,
      "status": "NEEDS_REVIEW",
      "summary": "PII Controller & Processor policies evaluated; partial retention schedule.",
      "rationale": "PII processor lifecycle roles defined; Clause 6.5.2 data retention schedule and Clause 6.5.4 temporary file sanitization need formalization."
    }
  },
  "Findings": [
    {
      "category": "Data Privacy",
      "severity": "HIGH",
      "issue": "Missing explicit 'Do Not Sell or Share Personal Information' notice clause",
      "location": "Clause 4.1",
      "recommendation": "Add explicit CCPA § 1798.120 compliant opt-out notice and link specifications."
    },
    {
      "category": "Security",
      "severity": "MEDIUM",
      "issue": "Temporary file sanitization policy missing under ISO 27701",
      "location": "Clause 6.2",
      "recommendation": "Document temporary storage purging controls per ISO/IEC 27701 Clause 6.5.4."
    }
  ],
  "risks": [
    {
      "category": "Data Privacy",
      "severity": "HIGH",
      "issue": "Missing explicit 'Do Not Sell or Share Personal Information' notice clause",
      "location": "Clause 4.1",
      "recommendation": "Add explicit CCPA § 1798.120 compliant opt-out notice and link specifications."
    }
  ]
}

Rules:
- "OverallScore", "GdprScore", "CcpaScore", "Soc2Score", "Iso27701Score": Exact integers 0 to 100 derived independently based on text evidence.
- "status": Exact string: "COMPLIANT" (score >= 80), "NEEDS_REVIEW" (score 60-79), or "NON_COMPLIANT" (score < 60).
- "rationale": Clear, specific explanation of distinct criteria satisfied vs missed for that framework.
- "Findings": Array of concrete findings with category ("Data Privacy", "Security", "Liability", "Termination", "IP Ownership", "Indemnification", "Confidentiality", "Payment Terms", "Governing Law", "Governance"), severity ("CRITICAL", "HIGH", "MEDIUM", "LOW"), issue, location, and recommendation.
Return ONLY valid JSON. No markdown backticks, no comments.
`

async function retrieveSupabaseRagGrounding(queryText: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return ""
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
    const embResp = await ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: queryText.slice(0, 2048),
      config: { outputDimensionality: 768 },
    })

    const vector = embResp.embeddings?.[0]?.values
    if (!vector || !vector.length) return ""

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_regulatory_rules`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query_embedding: vector,
        match_threshold: 0.0,
        match_count: 5,
      }),
    })

    if (!rpcRes.ok) return ""
    const chunks = await rpcRes.json()
    if (!Array.isArray(chunks) || chunks.length === 0) return ""

    const lines = chunks.slice(0, 5).map((item, idx) => {
      const fw = (item.framework || "Standard").toUpperCase()
      const ref = item.clause_reference || ""
      const title = item.title || ""
      const content = item.content || ""
      return `${idx + 1}. [${fw}] Ref: ${ref} | Title: ${title}\n   Standard Requirement: ${content}`
    })

    return `\n\n--- RETRIEVED REGULATORY BENCHMARKS (PGVECTOR GROUNDING) ---\n${lines.join("\n\n")}\n`
  } catch {
    return ""
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Identify client
    const authHeader = req.headers.get("authorization") || ""
    const forwardedFor = req.headers.get("x-forwarded-for") || ""
    const realIp = req.headers.get("x-real-ip") || ""

    let identifier = "anonymous-client"
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "").trim()
      identifier = `user:${token.slice(0, 32)}`
    } else if (forwardedFor) {
      identifier = `ip:${forwardedFor.split(",")[0].trim()}`
    } else if (realIp) {
      identifier = `ip:${realIp.trim()}`
    }

    // 2. Upstash Redis sliding window rate limiter (5 scans/hour)
    const rateLimit = await checkAuditRateLimit(identifier)

    const headers = {
      "X-RateLimit-Limit": rateLimit.limit.toString(),
      "X-RateLimit-Remaining": rateLimit.remaining.toString(),
      "X-RateLimit-Reset": rateLimit.reset.toString(),
    }

    if (!rateLimit.success) {
      const retryAfterSec = Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000))
      return NextResponse.json(
        {
          error: "Rate limit exceeded. You are limited to 5 document scans per hour.",
          limit: rateLimit.limit,
          remaining: rateLimit.remaining,
          reset: rateLimit.reset,
          timeToReset: rateLimit.timeToReset,
        },
        {
          status: 429,
          headers: {
            ...headers,
            "Retry-After": retryAfterSec.toString(),
          },
        },
      )
    }

    const body = await req.json().catch(() => ({}))
    const documentText = body.documentText || body.text || body.content || ""

    // 3. Direct Gemini 2.5 Flash Evaluation when text is provided
    if (documentText && documentText.trim().length > 0) {
      if (!GEMINI_API_KEY) {
        return NextResponse.json(
          { error: "GEMINI_API_KEY is not configured on the server." },
          { status: 500, headers },
        )
      }

      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

      // Retrieve RAG context from Supabase pgvector if available
      const ragGrounding = await retrieveSupabaseRagGrounding(documentText)

      const userPrompt = `${ragGrounding}
Analyze and score the following document text strictly according to the independent criteria for GDPR, SOC 2, CCPA, and ISO/IEC 27701:

=== DOCUMENT TEXT TO EVALUATE ===
${documentText.slice(0, 50000)}
`

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          { role: "system", parts: [{ text: GEMINI_AUDIT_SYSTEM_PROMPT }] },
          { role: "user", parts: [{ text: userPrompt }] },
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      })

      const rawJson = (response.text || "").trim()
      let parsedResult: any
      try {
        parsedResult = JSON.parse(rawJson)
      } catch {
        const cleaned = rawJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
        parsedResult = JSON.parse(cleaned)
      }

      const findFrameworkScore = (obj: any, keys: string[]): number | null => {
        if (!obj || typeof obj !== "object") return null
        for (const k of keys) {
          if (typeof obj[k]?.score === "number") return obj[k].score
          if (typeof obj[k] === "number") return obj[k]
        }
        for (const [rawK, rawV] of Object.entries(obj)) {
          const cleanK = rawK.toLowerCase().replace(/[\s_\-\/]/g, "")
          for (const k of keys) {
            const cleanTarget = k.toLowerCase().replace(/[\s_\-\/]/g, "")
            if (cleanK === cleanTarget) {
              if (typeof (rawV as any)?.score === "number") return (rawV as any).score
              if (typeof rawV === "number") return rawV
            }
          }
        }
        return null
      }

      const fws = parsedResult?.frameworks || parsedResult?.Frameworks || {}
      const rawOverall = parsedResult?.overall_score ?? parsedResult?.OverallScore ?? parsedResult?.Score

      const gdprScore =
        parsedResult?.GdprScore ??
        parsedResult?.gdpr_score ??
        findFrameworkScore(fws, ["gdpr", "GDPR"]) ??
        75

      const ccpaScore =
        parsedResult?.CcpaScore ??
        parsedResult?.ccpa_score ??
        findFrameworkScore(fws, ["ccpa", "cpra", "CCPA", "CPRA", "ccpa_cpra", "CCPA/CPRA"]) ??
        75

      const soc2Score =
        parsedResult?.Soc2Score ??
        parsedResult?.soc2_score ??
        findFrameworkScore(fws, ["soc2", "soc_2", "soc-2", "soc 2", "SOC2", "SOC 2"]) ??
        75

      const iso27701Score =
        parsedResult?.Iso27701Score ??
        parsedResult?.iso27701_score ??
        parsedResult?.IsoScore ??
        parsedResult?.iso_score ??
        findFrameworkScore(fws, ["iso27701", "iso_27701", "iso-27701", "iso 27701", "ISO27701", "ISO 27701", "ISO/IEC 27701", "iso/iec 27701", "iso27001", "iso", "ISO"]) ??
        Math.round((gdprScore + ccpaScore + soc2Score) / 3)

      const overallScore =
        typeof rawOverall === "number"
          ? rawOverall
          : Math.round((gdprScore + ccpaScore + soc2Score + iso27701Score) / 4)

      const normalizedFrameworks = {
        gdpr: {
          score: gdprScore,
          status: gdprScore >= 80 ? "COMPLIANT" : gdprScore >= 60 ? "NEEDS_REVIEW" : "NON_COMPLIANT",
          summary: fws?.gdpr?.summary || `GDPR independent evaluation score: ${gdprScore}/100.`,
          rationale: fws?.gdpr?.rationale || fws?.gdpr?.summary || "GDPR compliance criteria evaluated.",
        },
        soc2: {
          score: soc2Score,
          status: soc2Score >= 80 ? "COMPLIANT" : soc2Score >= 60 ? "NEEDS_REVIEW" : "NON_COMPLIANT",
          summary: fws?.soc2?.summary || `SOC 2 independent evaluation score: ${soc2Score}/100.`,
          rationale: fws?.soc2?.rationale || fws?.soc2?.summary || "SOC 2 Trust Services Criteria evaluated.",
        },
        ccpa: {
          score: ccpaScore,
          status: ccpaScore >= 80 ? "COMPLIANT" : ccpaScore >= 60 ? "NEEDS_REVIEW" : "NON_COMPLIANT",
          summary: fws?.ccpa?.summary || `CCPA independent evaluation score: ${ccpaScore}/100.`,
          rationale: fws?.ccpa?.rationale || fws?.ccpa?.summary || "CCPA statutory consumer rights evaluated.",
        },
        iso27701: {
          score: iso27701Score,
          status: iso27701Score >= 80 ? "COMPLIANT" : iso27701Score >= 60 ? "NEEDS_REVIEW" : "NON_COMPLIANT",
          summary: fws?.iso27701?.summary || `ISO/IEC 27701 independent evaluation score: ${iso27701Score}/100.`,
          rationale: fws?.iso27701?.rationale || fws?.iso27701?.summary || "ISO/IEC 27701 PII governance controls evaluated.",
        },
      }

      return NextResponse.json(
        {
          ...parsedResult,
          overall_score: overallScore,
          OverallScore: overallScore,
          Score: overallScore,
          GdprScore: gdprScore,
          gdpr_score: gdprScore,
          CcpaScore: ccpaScore,
          ccpa_score: ccpaScore,
          Soc2Score: soc2Score,
          soc2_score: soc2Score,
          Iso27701Score: iso27701Score,
          iso27701_score: iso27701Score,
          frameworks: normalizedFrameworks,
          rateLimit: {
            remaining: rateLimit.remaining,
            limit: rateLimit.limit,
            reset: rateLimit.reset,
            timeToReset: rateLimit.timeToReset,
          },
        },
        { status: 200, headers },
      )
    }

    // 4. Handle agreement audit proxy if requested
    if (body.groupId && body.documentIds) {
      const awsRes = await fetch(`${AWS_API_BASE}/agreement-audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      })
      const data = await awsRes.json().catch(() => ({}))
      const fws = data?.frameworks || data?.Frameworks || {}
      const gdprScore = data?.GdprScore ?? data?.gdpr_score ?? fws?.gdpr?.score
      const ccpaScore = data?.CcpaScore ?? data?.ccpa_score ?? fws?.ccpa?.score
      const soc2Score = data?.Soc2Score ?? data?.soc2_score ?? fws?.soc2?.score
      const iso27701Score =
        data?.Iso27701Score ??
        data?.iso27701_score ??
        data?.IsoScore ??
        data?.iso_score ??
        fws?.iso27701?.score ??
        fws?.iso_27701?.score ??
        fws?.["ISO/IEC 27701"]?.score
      const overallScore = data?.overall_score ?? data?.OverallScore ?? data?.Score

      return NextResponse.json(
        {
          ...data,
          ...(overallScore !== undefined ? { overall_score: overallScore, OverallScore: overallScore, Score: overallScore } : {}),
          ...(gdprScore !== undefined ? { GdprScore: gdprScore, gdpr_score: gdprScore } : {}),
          ...(ccpaScore !== undefined ? { CcpaScore: ccpaScore, ccpa_score: ccpaScore } : {}),
          ...(soc2Score !== undefined ? { Soc2Score: soc2Score, soc2_score: soc2Score } : {}),
          ...(iso27701Score !== undefined ? { Iso27701Score: iso27701Score, iso27701_score: iso27701Score } : {}),
          remaining: rateLimit.remaining,
          timeToReset: rateLimit.timeToReset,
        },
        { status: awsRes.status, headers },
      )
    }

    return NextResponse.json(
      {
        message: "Audit scan authorized.",
        remaining: rateLimit.remaining,
        limit: rateLimit.limit,
        reset: rateLimit.reset,
        timeToReset: rateLimit.timeToReset,
      },
      { status: 200, headers },
    )
  } catch (err: any) {
    console.error("[API Audit Route] Error:", err)
    return NextResponse.json(
      { error: err?.message || "Internal server error during audit evaluation." },
      { status: 500 },
    )
  }
}
