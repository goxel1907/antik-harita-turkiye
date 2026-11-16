"""R2544.185 generated Java source checks for section show/hide. Not Android compilation or a phone run."""
from pathlib import Path
import os, unittest
APP = Path(os.environ.get('JEV_MARGIN_GENERATED_APP', '/tmp/futures15m-build/Futures15mAlarm'))
J = APP / 'app/src/main/java/com/futuresalarm/app'
def method(s, n):
    a = s.index(n); return s[a:s.index('\n    }', a) + 6]
class BolumlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = (J / 'MainActivity.java').read_text(encoding='utf-8')
        cls.g = (APP / 'app/build.gradle').read_text(encoding='utf-8')
    def test_applied_after_every_refresh(self):
        self.assertIn('try { v95152ApplySections(); } catch (Throwable ignored) {} // V95152_R2544_185_BOLUMLER', self.m)
        i = self.m.index('V95147_R2544_147_SERIT_GIZLE'); j = self.m.index('V95152_R2544_185_BOLUMLER', i)
        self.assertLess(j - i, 200, 'hooked right after the bar-hiding step of the dynamic refresh')
    def test_only_off_sections_are_hidden_never_forced_visible(self):
        s = method(self.m, '    private void v95152ApplySections(')
        self.assertIn('if (v95152On(sp, s)) continue;', s)
        self.assertNotIn('View.VISIBLE', s)
    def test_view_only_nothing_sent_to_pc_no_orders(self):
        for n in ['    private void v95152ApplySections(', '    private void v95152SectionsDialog(']:
            s = method(self.m, n)
            for forbidden in ['BrainHubClient.', 'selectLane(', '/live/execute', 'runControl(', 'GO_LIVE', 'setLaneSize(']:
                self.assertNotIn(forbidden, s, forbidden)
    def test_known_card_tags_and_defaults(self):
        for tag in ['v95146_pos_card', 'v95132_lanes_card', 'v95149_kesif_card', 'v95127_desk_card', 'v9549_recent_real_trades', 'v9558_signal_journal_card']:
            self.assertIn('{"' + tag + '", ', self.m)
            self.assertIn('setTag("' + tag + '")' if tag not in ('v95132_lanes_card',) else tag, self.m)
        self.assertIn('{"v9540_futures_radar_card", "Radar (ayrıntı)", "0"}', self.m)
    def test_reenabled_section_shown_once_then_left_to_installer(self):
        s = method(self.m, '    private void v95152SectionsDialog(')
        self.assertIn('if (on[i] && !before[i])', s); self.assertIn('setVisibility(android.view.View.VISIBLE)', s)
        self.assertIn('yalnız görünüm', s)
    def test_version(self):
        self.assertIn("versionName '9.5.145-r2544.185-bolumler'", self.g)
if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(BolumlerTests))
    if not result.wasSuccessful(): raise SystemExit(1)
    print('BOLUMLER_SOURCE_TESTS_6_OK')
