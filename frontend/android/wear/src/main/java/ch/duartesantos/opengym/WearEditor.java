package ch.duartesantos.opengym;
import java.math.BigDecimal;
/** Draft only; confirmation never mutates the received workout snapshot. */
final class WearEditor {
 final String context, target, field, unit; final double baseline, step; double value; boolean pending;
 WearEditor(String context, String target, String field, String unit, double value, double step) {
  this.context=context; this.target=target; this.field=field; this.unit=unit; this.baseline=value; this.value=Double.isNaN(value) ? 0 : value;
  this.step="r".equals(field) ? 1 : (Double.isFinite(step) && step>0 ? step : 1);
 }
 void adjust(int direction) {
  if(pending)return;
  value=Math.max(0,Math.min(10000,BigDecimal.valueOf(value).add(BigDecimal.valueOf(step).multiply(BigDecimal.valueOf(direction))).doubleValue()));
 }
 boolean matches(String context, String target, String unit, double baseline) {
  return this.context.equals(context) && this.target.equals(target) && this.unit.equals(unit) && Double.compare(this.baseline,baseline)==0;
 }
 static boolean heartFresh(boolean running, double bpm, long readingAt, long now) {
  return running && Double.isFinite(bpm) && bpm>=25 && bpm<=250 && readingAt>0 && now>=readingAt && now-readingAt<=15000;
 }
 static String number(double value) { return BigDecimal.valueOf(value).stripTrailingZeros().toPlainString(); }
}
