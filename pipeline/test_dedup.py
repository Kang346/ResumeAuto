"""Unit tests for pipeline.dedup. Run: python -m unittest pipeline.test_dedup"""

import unittest

from pipeline.dedup import (
    compute_keys,
    extract_req_id,
    normalize_company,
    normalize_location,
    normalize_title,
    parse_ats,
)


class NormalizeCompany(unittest.TestCase):
    def test_strips_legal_suffixes(self):
        self.assertEqual(normalize_company("Anthropic, Inc."), "anthropic")
        self.assertEqual(normalize_company("Stripe Inc"), "stripe")
        self.assertEqual(normalize_company("Acme LLC"), "acme")
        self.assertEqual(normalize_company("Foo Co."), "foo")
        self.assertEqual(normalize_company("Foo, Ltd."), "foo")

    def test_no_suffix_unchanged(self):
        self.assertEqual(normalize_company("Anthropic"), "anthropic")
        self.assertEqual(normalize_company("OpenAI"), "openai")

    def test_whitespace_and_case(self):
        self.assertEqual(normalize_company("  Anthropic , Inc.  "), "anthropic")


class NormalizeTitle(unittest.TestCase):
    def test_swe_expands(self):
        self.assertEqual(
            normalize_title("SWE I"), normalize_title("Software Engineer I")
        )

    def test_sde_expands(self):
        self.assertEqual(
            normalize_title("SDE II"), normalize_title("Software Development Engineer II")
        )

    def test_mle_expands(self):
        self.assertEqual(
            normalize_title("MLE Intern"),
            normalize_title("Machine Learning Engineer Intern"),
        )

    def test_preserves_parentheticals(self):
        # Conservative-normalization regression: New Grad vs Senior must stay distinct.
        self.assertNotEqual(
            normalize_title("Software Engineer (New Grad)"),
            normalize_title("Software Engineer (Senior)"),
        )

    def test_preserves_comma_suffix(self):
        # Different teams = different roles, must stay distinct.
        self.assertNotEqual(
            normalize_title("Compiler Verification Engineer, NCG"),
            normalize_title("Compiler Verification Engineer, AI Platform"),
        )

    def test_dash_unification(self):
        self.assertEqual(
            normalize_title("Engineer – AI"), normalize_title("Engineer - AI")
        )
        self.assertEqual(
            normalize_title("Engineer — AI"), normalize_title("Engineer - AI")
        )


class NormalizeLocation(unittest.TestCase):
    def test_remote_us_variants_collapse(self):
        canon = "remote-us"
        for form in ["Remote (US)", "Remote - US", "Remote, US", "US Remote", "Remote United States"]:
            self.assertEqual(normalize_location(form), canon, form)

    def test_metros_stay_distinct(self):
        self.assertNotEqual(
            normalize_location("San Francisco, CA"),
            normalize_location("San Jose, CA"),
        )

    def test_case_collapse(self):
        self.assertEqual(
            normalize_location("New York, NY"), normalize_location("new york, ny")
        )


class ExtractReqId(unittest.TestCase):
    def test_from_url(self):
        self.assertEqual(extract_req_id("https://x.com/job/foo_R-12345"), "R12345")

    def test_from_title(self):
        self.assertEqual(extract_req_id("", "Software Engineer (JR-98765)"), "JR98765")

    def test_no_hyphen(self):
        self.assertEqual(extract_req_id("REQ123456 - Engineer"), "REQ123456")

    def test_none(self):
        self.assertIsNone(extract_req_id("Software Engineer", "no req here"))


class ParseATS(unittest.TestCase):
    def test_greenhouse_classic(self):
        self.assertEqual(
            parse_ats("https://boards.greenhouse.io/anthropic/jobs/4567890"),
            ("gh", "anthropic", "4567890"),
        )

    def test_greenhouse_modern(self):
        self.assertEqual(
            parse_ats("https://job-boards.greenhouse.io/anthropic/jobs/4567890"),
            ("gh", "anthropic", "4567890"),
        )

    def test_greenhouse_embed(self):
        self.assertEqual(
            parse_ats("https://boards.greenhouse.io/embed/job_app?for=acme&token=999"),
            ("gh", "acme", "999"),
        )

    def test_lever(self):
        self.assertEqual(
            parse_ats("https://jobs.lever.co/openai/abcdef12-3456-7890-abcd-ef1234567890"),
            ("lever", "openai", "abcdef12-3456-7890-abcd-ef1234567890"),
        )

    def test_ashby(self):
        self.assertEqual(
            parse_ats("https://jobs.ashbyhq.com/cohere/abcdef12-3456-7890-abcd-ef1234567890/application"),
            ("ashby", "cohere", "abcdef12-3456-7890-abcd-ef1234567890"),
        )

    def test_workday(self):
        self.assertEqual(
            parse_ats(
                "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Compiler-Engineer_R-12345"
            ),
            ("wd", "nvidia", "R12345"),
        )

    def test_linkedin(self):
        self.assertEqual(
            parse_ats("https://www.linkedin.com/jobs/view/3987654321/?refId=foo"),
            ("li", "", "3987654321"),
        )

    def test_unknown_host(self):
        self.assertIsNone(parse_ats("https://acmecorp.com/careers/swe-2025"))

    def test_empty(self):
        self.assertIsNone(parse_ats(""))


class ComputeKeys(unittest.TestCase):
    def test_l1_when_ats_known(self):
        out = compute_keys(
            url="https://boards.greenhouse.io/anthropic/jobs/4567890",
            company="Anthropic, Inc.",
            title="Software Engineer (New Grad)",
            location="San Francisco, CA",
        )
        self.assertEqual(out["dedup_key"], "gh:anthropic:4567890")
        self.assertEqual(out["job_signature"], "anthropic|software engineer (new grad)|san francisco, ca")

    def test_workday_l1_uses_req_id(self):
        out = compute_keys(
            url="https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Compiler-Engineer_R-12345",
            company="NVIDIA",
            title="Compiler Engineer",
            location="Santa Clara, CA",
        )
        self.assertEqual(out["dedup_key"], "wd:nvidia:R12345")
        self.assertEqual(out["req_id"], "R12345")

    def test_unknown_host_falls_to_l3(self):
        out = compute_keys(
            url="https://acmecorp.com/careers/swe-2025",
            company="Acme",
            title="Software Engineer",
            location="Remote (US)",
        )
        self.assertEqual(out["dedup_key"], "acme|software engineer|remote-us")
        self.assertEqual(out["dedup_key"], out["job_signature"])

    def test_l2_when_req_id_in_title_no_ats(self):
        out = compute_keys(
            url="https://acmecorp.com/careers/foo",
            company="Acme",
            title="Software Engineer (R-44444)",
            location="NYC",
        )
        self.assertEqual(out["dedup_key"], "acme:req:R44444")

    def test_swe_dedups_with_full_form(self):
        a = compute_keys(
            url="https://acmecorp.com/careers/x",
            company="Acme",
            title="SWE I",
            location="NYC",
        )
        b = compute_keys(
            url="https://acmecorp.com/careers/y",
            company="Acme",
            title="Software Engineer I",
            location="NYC",
        )
        self.assertEqual(a["dedup_key"], b["dedup_key"])

    def test_new_grad_vs_senior_distinct(self):
        a = compute_keys(
            url="https://acmecorp.com/careers/x",
            company="Acme",
            title="Software Engineer (New Grad)",
            location="NYC",
        )
        b = compute_keys(
            url="https://acmecorp.com/careers/y",
            company="Acme",
            title="Software Engineer (Senior)",
            location="NYC",
        )
        self.assertNotEqual(a["dedup_key"], b["dedup_key"])

    def test_company_suffix_collapses(self):
        a = compute_keys(
            url="https://acmecorp.com/careers/x",
            company="Acme, Inc.",
            title="Software Engineer",
            location="NYC",
        )
        b = compute_keys(
            url="https://acmecorp.com/careers/y",
            company="Acme",
            title="Software Engineer",
            location="NYC",
        )
        self.assertEqual(a["dedup_key"], b["dedup_key"])


if __name__ == "__main__":
    unittest.main()
