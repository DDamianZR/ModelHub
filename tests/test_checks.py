"""checks.py: the one standard describe.py and audit.py both run. One test per defect
family `problems()` can reject, plus the contradicts_data() and profile() machinery
Block 2 added.
"""
import unittest

from scripts.enrich.checks import contradicts_data, problems, profile


def _model(**overrides):
    base = {
        "display_name": "Test Model",
        "is_open_weights": False,
        "coverage": {"covered": 5, "total": 5, "missing": []},
        "category_scores": {
            "reasoning": 90.0, "coding": 85.0, "math": 70.0,
            "instruction_following": 60.0, "human_preference": 55.0,
        },
    }
    base.update(overrides)
    return base


# A clean pair: today's profile is {reasoning, coding} strong, {human_preference,
# instruction_following} weak, math unclaimed - and this text claims exactly that.
_ES = (
    "Modelo Test es un modelo de lenguaje desarrollado por TestCorp en marzo de 2026. "
    "Solo por API: sus pesos no se publican, no se ejecuta localmente. "
    "Destaca relativamente en Razonamiento y Código. "
    "Algo por debajo en Instrucciones y Preferencia humana."
)
_EN = (
    "Test Model is a language model built by TestCorp in March 2026. "
    "API-only: its weights are not published, so it cannot be run locally. "
    "It is relatively stronger in Reasoning and Coding. "
    "Relatively lower in Instructions and Human preference."
)


class BaselineIsCleanTest(unittest.TestCase):
    def test_the_fixture_itself_is_publishable(self):
        """Every other test in this file breaks one thing about this pair. If the
        baseline itself isn't clean, every other test's assertion is meaningless."""
        self.assertEqual(problems(_ES, _EN, _model()), [])


class OneDefectPerFamilyTests(unittest.TestCase):
    def test_empty_text(self):
        found = problems("", _EN, _model())
        self.assertTrue(any("empty" in p for p in found))

    def test_too_few_words(self):
        found = problems("Muy corto.", _EN, _model())
        self.assertTrue(any("words" in p for p in found))

    def test_banned_marketing_phrase(self):
        broken = _EN.replace("stronger", "cutting-edge")
        found = problems(_ES, broken, _model())
        self.assertTrue(any("banned phrase" in p for p in found))

    def test_open_source_is_banned_even_though_it_is_not_marketing(self):
        broken = _EN.replace("API-only", "It is open source")
        found = problems(_ES, broken, _model())
        self.assertTrue(any("banned phrase" in p for p in found))

    def test_too_few_sentences(self):
        found = problems("Solo una oracion muy larga que dice muchas cosas seguidas.",
                          "Just one long sentence that says many things in a row here.",
                          _model())
        self.assertTrue(any("sentence(s)" in p for p in found))

    def test_sentence_too_long(self):
        long_sentence = "Word " * 30 + "end."
        found = problems(_ES, long_sentence, _model())
        self.assertTrue(any("one idea per sentence" in p for p in found))

    def test_contains_a_percentage(self):
        broken = _EN.replace("Coding", "Coding (90%)")
        found = problems(_ES, broken, _model())
        self.assertTrue(any("percentage" in p for p in found))

    def test_contains_a_decimal_figure(self):
        broken = _EN.replace("Coding", "Coding at 85.5")
        found = problems(_ES, broken, _model())
        self.assertTrue(any("decimal figure" in p for p in found))

    def test_contains_markup(self):
        found = problems(_ES, "{" + _EN, _model())
        self.assertTrue(any("markup" in p for p in found))

    def test_category_named_more_than_once(self):
        broken = _EN + " Reasoning is also mentioned again here for good measure today."
        found = problems(_ES, broken, _model())
        self.assertTrue(any("named more than once" in p for p in found))

    def test_comparative_language_below_the_coverage_gate(self):
        thin = _model(coverage={"covered": 2, "total": 5, "missing": ["math", "coding",
                                                                        "instruction_following"]})
        found = problems(_ES, _EN, thin)
        self.assertTrue(any("comparative language" in p for p in found))

    def test_untranslated_english_inside_spanish(self):
        broken_es = _ES + " Fue built by a team of engineers somewhere."
        found = problems(broken_es, _EN, _model())
        self.assertTrue(any("untranslated English" in p for p in found))

    def test_es_and_en_disagree_about_availability(self):
        broken_es = _ES.replace("Solo por API", "Es de pesos abiertos")
        found = problems(broken_es, _EN, _model())
        self.assertTrue(any("disagree about availability" in p for p in found))

    def test_es_paraphrase_without_exact_keyword_is_not_a_disagreement(self):
        # A real regeneration for moonshot-kimi-k2.5 (2026-08-29) wrote this exact Spanish
        # paraphrase for an open-weights model: open in meaning, but matching neither
        # _OPEN_CLAIM nor _CLOSED_CLAIM verbatim, paired with an English sentence that does
        # use "open-weights". The two do not contradict each other - the old check compared
        # exact-phrase presence rather than an actual open-vs-closed conflict, and rejected
        # this correct pair on four separate generation attempts.
        es_paraphrase = _ES.replace(
            "Solo por API: sus pesos no se publican, no se ejecuta localmente.",
            "Se descarga y corre localmente, sin API.",
        )
        en_open = _EN.replace(
            "API-only: its weights are not published, so it cannot be run locally.",
            "It is open-weights: downloadable and runnable locally.",
        )
        found = problems(es_paraphrase, en_open, _model(is_open_weights=True))
        self.assertFalse(any("disagree about availability" in p for p in found))

    def test_claims_api_only_for_an_open_weights_model(self):
        found = problems(_ES, _EN, _model(is_open_weights=True))
        self.assertTrue(any("API-only for an open-weights model" in p for p in found))

    def test_claims_open_weights_for_an_api_only_model(self):
        broken_es = _ES.replace("Solo por API: sus pesos no se publican, "
                                 "no se ejecuta localmente.",
                                 "Es de pesos abiertos: se descarga y corre localmente.")
        broken_en = _EN.replace("API-only: its weights are not published, "
                                 "so it cannot be run locally.",
                                 "It is open-weights: downloadable and runnable locally.")
        found = problems(broken_es, broken_en, _model(is_open_weights=False))
        self.assertTrue(any("open weights for an API-only model" in p for p in found))


class ContradictsDataTests(unittest.TestCase):
    def test_stale_strength_claim_is_flagged(self):
        """Today reasoning/coding are the strong pair; claiming math instead must fail."""
        broken = _EN.replace("Reasoning and Coding", "Math and Coding")
        found = contradicts_data(_ES, broken, _model())
        self.assertTrue(any("claims strength in 'Math'" in p for p in found))

    def test_stale_weakness_claim_is_flagged(self):
        broken = _EN.replace("Instructions and Human preference", "Instructions and Math")
        found = contradicts_data(_ES, broken, _model())
        self.assertTrue(any("claims weakness in 'Math'" in p for p in found))

    def test_stale_no_data_claim_is_flagged_regardless_of_coverage(self):
        text = "Not measured: Math."
        found = contradicts_data(text, text, _model())
        self.assertTrue(any("no data for 'Math'" in p for p in found))

    def test_measured_and_unmeasured_lists_either_side_of_a_semicolon_are_not_confused(self):
        """The provisional-model shape: "Measured in X, Y; no data for Z" must not read
        the measured half as also claiming no data."""
        provisional = _model(coverage={"covered": 2, "total": 5,
                                        "missing": ["coding", "instruction_following",
                                                    "human_preference"]},
                              category_scores={"reasoning": 90.0, "math": 70.0})
        text = "Measured in Reasoning, Math; no data for Coding, Instructions."
        found = contradicts_data(text, text, provisional)
        self.assertEqual(found, [])

    def test_accurate_claims_produce_no_findings(self):
        self.assertEqual(contradicts_data(_ES, _EN, _model()), [])

    def test_below_the_coverage_gate_strong_weak_claims_are_not_re_checked(self):
        """checks._COMPARATIVE already rejects any comparison below the gate; re-checking
        it here would just duplicate that rejection under a different message."""
        thin = _model(coverage={"covered": 2, "total": 5, "missing": ["math", "coding",
                                                                        "instruction_following"]})
        broken = _EN.replace("Reasoning and Coding", "Math and Coding")
        found = contradicts_data(_ES, broken, thin)
        self.assertEqual(found, [])


class ProfileTests(unittest.TestCase):
    def test_strengths_and_weaknesses_never_overlap_with_three_categories(self):
        """Naive top-2/bottom-2 returns the same category twice at three or fewer
        measured categories - the bug that hit 24 models in one pass."""
        model = _model(category_scores={"reasoning": 90.0, "coding": 70.0, "math": 50.0},
                        coverage={"covered": 3, "total": 5,
                                  "missing": ["instruction_following", "human_preference"]})
        strengths, weaknesses, _ = profile(model, "en")
        strong_set = set(strengths.split(", "))
        weak_set = set(weaknesses.split(", "))
        self.assertEqual(strong_set & weak_set, set())

    def test_no_scores_returns_empty_profile(self):
        model = _model(category_scores={})
        self.assertEqual(profile(model, "en"), ("", "", ""))


if __name__ == "__main__":
    unittest.main()
