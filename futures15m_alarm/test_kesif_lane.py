"""Generated Java source checks. Not Android compilation or a phone run."""
from pathlib import Path
import os,unittest
APP=Path(os.environ.get('JEV_MARGIN_GENERATED_APP','/tmp/futures15m-build/Futures15mAlarm'))
J=APP/'app/src/main/java/com/futuresalarm/app'
def method(s,n):
 a=s.index(n);return s[a:s.index('\n    }',a)+6]
class KesifLaneTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.m=(J/'MainActivity.java').read_text(encoding='utf-8');cls.p=(J/'V95113PcTruth.java').read_text(encoding='utf-8')
 def test_primary_card_has_a_real_kesif_selection_button_and_refresh(self):
  s=method(self.m,'    private void v95132InstallLanesCard(')
  self.assertIn('v95151_btn_kesif',s);self.assertIn('v95151KesifLane()',s);self.assertGreaterEqual(s.count('v95151_btn_kesif'),2)
 def test_top_labels_come_from_pc_selection_for_each_lane(self):
  s=method(self.m,'    private void v95132InstallLanesCard(')
  for lane in ['normal','top3','zirve5','kesif']:self.assertIn('v95151LaneLabel(sp, "'+lane+'"',s)
  p=method(self.p,'    static String v95151LaneLabel(')
  self.assertIn('r2544_57_run',p);self.assertIn('optBoolean("selected"',p);self.assertIn('SEÇİLİ',p)
 def test_shadow_learning_and_real_entry_permission_have_different_labels(self):
  s=method(self.m,'    private void v95132InstallLanesCard(')
  self.assertIn('KEŞİF gölge tahmin / öğrenim',s);self.assertIn('KEŞİF-SÖZ gerçek giriş izni',self.m)
 def test_only_absolute_kesif_lane_selection_is_sent(self):
  s=method(self.m,'    private void v95151KesifLane(')
  self.assertIn('BrainHubClient.selectLane(this, "kesif", !on, live && !on)',s)
  for forbidden in ['setLaneSize(', 'configureKesif(', 'runControl(', 'GO_LIVE', 'setEnabled(', 'goxelExit']:
   self.assertNotIn(forbidden,s)
 def test_pc_acceptance_is_required_and_failed_request_does_not_persist_local_choice(self):
  s=method(self.m,'    private void v95151KesifLane(')
  self.assertIn('optJSONObject("kesif")',s);self.assertIn('accepted.optBoolean("selected"',s)
  for forbidden in ['putBoolean(', '.edit()', '.apply()', '.commit()']:self.assertNotIn(forbidden,s)
 def test_unknown_or_stale_pc_truth_cannot_toggle(self):
  s=method(self.m,'    private void v95151KesifLane(')
  self.assertIn('v95151Fresh',s);self.assertIn('lane == null',s);self.assertIn('has("selected")',s)
  p=method(self.p,'    static boolean v95151Fresh(');self.assertIn('r2544_57_status_ts',p);self.assertIn('30000',p)
 def test_off_explains_only_new_entries_stop(self):
  s=method(self.m,'    private void v95151KesifLane(')
  self.assertIn('Yalnız yeni KEŞİF-SÖZ girişleri',s);self.assertIn('öğrenim ve açık pozisyon yönetimi sürer',s)
if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(KesifLaneTests))
 if not result.wasSuccessful():raise SystemExit(1)
 print('KESIF_LANE_SOURCE_TESTS_7_OK')
