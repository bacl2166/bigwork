from html import escape
from .service import DIMENSIONS


def esc(value):
    return escape(str(value), quote=True)


def render_report(analysis, session=None):
    a = analysis
    engine = '规则演示（非大模型推理）' if a['mode'] == 'demo' else a['model']
    rows = ''.join(f'<tr><td>{esc(r["name"])}</td><td>{"必需" if r["importance"] == "required" else "加分"}</td><td>{esc(r["status_label"])}</td><td>{"<br>".join(esc(e["quote"]) for e in r["evidence"]) or "暂无材料证据"}</td></tr>' for r in a['requirements'])
    issues = ''.join(f'<article><blockquote>{esc(i["quote"])}</blockquote><p>{esc(i["problem"])}</p><p>建议：{esc(i["suggestion"])}</p></article>' for i in a['issues']) or '<p>未识别到具体问题，请人工复核。</p>'
    interview = ''
    if session:
        turns = session['turns']
        if turns:
            scores = {k: round(sum(t['feedback']['scores'][k] for t in turns)/len(turns), 2) for k in DIMENSIONS}
            bars = ''.join(f'<tr><td>{label}</td><td><meter min="0" max="5" value="{scores[k]}"></meter> {scores[k]} / 5</td></tr>' for k, label in DIMENSIONS.items())
            details = ''.join(f'<article><h3>第 {n} 轮 · {esc(t["question"]["focus"])}</h3><p>问题：{esc(t["question"]["question"])}</p><blockquote>{esc(t["answer"])}</blockquote><p>{esc(t["feedback"]["reason"])}</p><p>改进：{esc("；".join(t["feedback"]["improvements"]))}</p><p>练习：{esc(t["feedback"]["practice"])}</p></article>' for n, t in enumerate(turns, 1))
            weak = sorted(scores, key=scores.get)[:2]
            interview = f'<h2>模拟面试 · 已答 {len(turns)} / {session["rounds"]} 轮</h2><table>{bars}</table><p>优先训练：{esc("、".join(DIMENSIONS[k] for k in weak))}</p>{details}'
        else:
            interview = '<h2>模拟面试</h2><p>尚未提交回答。</p>'
    gaps = '、'.join(r['name'] for r in a['requirements'] if r['status'] != 'proven') or '暂未发现明显材料缺口'
    warnings = ''.join(f'<li>{esc(w)}</li>' for w in a['validation_warnings'])
    return f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CareerLens 训练报告</title>
<style>body{{font:16px/1.8 system-ui,"Microsoft YaHei",sans-serif;color:#20312d;max-width:1000px;margin:40px auto;padding:0 24px}}h1,h2{{color:#146451}}h2{{margin-top:36px;border-bottom:1px solid #cbd9d3}}table{{border-collapse:collapse;width:100%}}td,th{{padding:12px;border:1px solid #d5ded9;text-align:left}}blockquote{{white-space:pre-wrap;margin:12px 0;background:#f1f5f2;padding:14px;border-left:3px solid #72a38b}}article{{break-inside:avoid;border-bottom:1px solid #ddd;padding:12px 0}}meter{{width:180px}}.note{{color:#65736b}}@media print{{body{{margin:0;max-width:none}}}}</style>
<h1>CareerLens 求职训练报告</h1><p>{esc(a['project_name'])} · {esc(a['created_at'])}</p><p class="note">分析引擎：{esc(engine)}。仅供个人训练参考，匹配分表示材料证据覆盖度，不是录用概率。</p>
<h2>材料诊断</h2><p>{esc(a['summary'])}</p><p>岗位证据覆盖分：<strong>{a['match_score']} / 100</strong></p>
<h2>岗位证据矩阵</h2><table><thead><tr><th>能力</th><th>权重</th><th>证据状态</th><th>简历原文</th></tr></thead><tbody>{rows}</tbody></table>
<p>计算：必需权重 2，加分权重 1；有行动证据 1，仅提及 0.4，尚缺证据 0；按加权覆盖率折算至百分制。行动词规则与模型相关性判断都需要人工复核。</p>
<h2>逐条改进建议</h2>{issues}<ul>{warnings}</ul><h2>能力补足清单</h2><p>{esc(gaps)}</p><p>优先补充真实的个人行动、交付物与验证方法；只有技能名称时，准备一个可以演示的小项目。不要填写未经测量的指标。</p>{interview}
<h2>原始材料快照</h2><details><summary>简历与岗位</summary><h3>简历</h3><blockquote>{esc(a['resume'])}</blockquote><h3>岗位</h3><blockquote>{esc(a['job'])}</blockquote></details>
<p class="note">所有分析在本机完成。可用浏览器“打印 → 保存为 PDF”导出本报告。</p></html>'''
