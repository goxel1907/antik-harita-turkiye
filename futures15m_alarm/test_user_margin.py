"""Source-generation checks; these do not assert Android compilation or a device run."""
from pathlib import Path
import os,unittest,re
APP=Path(os.environ.get('JEV_MARGIN_GENERATED_APP','/tmp/futures15m-build/Futures15mAlarm'))
J=APP/'app/src/main/java/com/futuresalarm/app'
def method(s,needle):
 a=s.index(needle);return s[a:s.index('\n    }',a)+6]
class MarginSourceTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.c=(J/'BrainHubClient.java').read_text(encoding='utf-8');cls.m=(J/'MainActivity.java').read_text(encoding='utf-8')
 def test_periodic_sync_is_get_only(self):
  s=method(self.c,'    public static JSONObject syncLeaderAutoSizing(')
  self.assertIn('return leaderAutoStatus(c)',s);self.assertNotIn('post(',s)
 def test_explicit_lane_and_revision_reach_canonical_pc_route(self):
  s=method(self.c,'    public static JSONObject setLaneSize(')
  for field in ['lane','marginQuote','leverage','expectedRevision','source']:self.assertIn('body.put("'+field+'"',s)
  self.assertIn('post(c,"/live/sizing",body,true)',s)
  self.assertNotIn('"/live/top3"',s);self.assertNotIn('"/live/execute"',s);self.assertNotIn('confirm',s)
 def test_existing_normal_dialog_uses_one_pc_snapshot_for_value_and_revision(self):
  s=method(self.m,'    private void v9576ShowAutoSettings()')
  self.assertIn('normalSizing.optString("revision"',s);self.assertIn('normalSizing.optDouble("marginQuote"',s);self.assertIn('normalSizing.optInt("leverage"',s)
  self.assertNotIn('mg.setText(sp.getString("v9576_auto_margin"',s)
 def test_lane_dialog_freezes_the_opened_revision(self):
  s=method(self.m,'    private void v95136SizeDialog(')
  self.assertIn('final String expectedRevision=',s);self.assertIn('false, expectedRevision)',s)
  self.assertIn('r2544_171_user_sizing',s);self.assertIn('optJSONObject(lane)',s)
 def test_all_five_lanes_have_an_explicit_form(self):
  self.assertIn('v95136SizeDialog("top3")',self.m);self.assertIn('v95136SizeDialog("zirve5")',self.m)
  self.assertIn('new String[]{"normal","burst","kesif"}',self.m)
 def test_success_comes_from_pc_acceptance_not_local_draft(self):
  s=method(self.m,'    private void v95136SizeDialog(')
  self.assertIn('out.optDouble("marginQuote")',s);self.assertIn('out.optInt("leverage")',s)
  self.assertNotIn('m + " USDT") + " × " + fl',s)
  s=method(self.m,'    private void v9576ShowAutoSettings()')
  self.assertIn('PC marj onayı bekleniyor',s);self.assertNotIn('Toast.makeText(this,"Ayar kaydedildi',s)
 def test_saving_does_not_depend_on_wallet_or_activate_orders(self):
  s=method(self.c,'    public static JSONObject setLaneSize(')
  for forbidden in ['availableBalance','liveArm(','"/live/run"','"/live/execute"','marginQuote *']:self.assertNotIn(forbidden,s)
  self.assertIn('Double.isInfinite(m)',s);self.assertIn('m<=0',s)
 def test_java_lexical_delimiters_are_balanced(self):
  for name,s in [('client',self.c),('main',self.m)]:
   stack=[];i=0;quote=None
   while i<len(s):
    ch=s[i]
    if s.startswith('//',i):
     i=s.find('\n',i)
     if i<0:break
     continue
    if s.startswith('/*',i):
     n=s.find('*/',i+2);self.assertGreaterEqual(n,0,name);i=n+2;continue
    if ch in ['"',"'"]:
     q=ch;i+=1
     while i<len(s):
      if s[i]=='\\':i+=2;continue
      if s[i]==q:break
      self.assertNotEqual(s[i],'\n',name+' newline in literal');i+=1
     self.assertLess(i,len(s),name+' unterminated literal')
    elif ch in '({[':stack.append(ch)
    elif ch in ')}]':
     self.assertTrue(stack,name+' unexpected close')
     self.assertEqual(stack.pop(),{')':'(',']':'[','}':'{'}[ch],name)
    i+=1
   self.assertFalse(stack,name)
if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(MarginSourceTests))
 if not result.wasSuccessful():raise SystemExit(1)
 print('V95150_MARGIN_SOURCE_TESTS_OK: '+str(result.testsRun)+' checks; NOT an Android build/device test.')
