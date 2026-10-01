import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import naming from "./config/naming.json";

const withNextIntl = createNextIntlPlugin();

// A model id changes when an identity rule is corrected (Qwen3.8 Max used to share a key
// with the Qwen3.8 family). Old links keep working: they redirect to the corrected id.
const renamed: Record<string, string> = naming.renamed_model_ids ?? {};

const nextConfig: NextConfig = {
  async redirects() {
    return Object.entries(renamed).map(([from, to]) => ({
      source: `/:locale(es|en)/model/${from}`,
      destination: `/:locale/model/${to}`,
      permanent: true,
    }));
  },
};

export default withNextIntl(nextConfig);
