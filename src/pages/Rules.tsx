import { Bell, Check, Layers3, MousePointerClick, Trophy, X } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { Fruit } from '../components/Fruit'

export default function Rules() {
  return (
    <div className="content-page rules-page">
      <PageHeader eyebrow="HOW TO PLAY" title="규칙은 간단해요." description="같은 과일이 정확히 다섯 개 보이면, 누구보다 먼저 종을 울리세요." />
      <section className="rule-hero">
        <div className="rule-card"><Fruit kind="strawberry" count={3} size="large" /><b>3</b></div>
        <span className="plus-sign">+</span>
        <div className="rule-card"><Fruit kind="strawberry" count={2} size="large" /><b>2</b></div>
        <span className="equals-sign">=</span>
        <div className="rule-bell"><Bell /><strong>지금!</strong></div>
      </section>
      <section className="rule-grid">
        <article><span>1</span><Layers3 /><h2>카드를 뒤집어요.</h2><p>자기 차례가 되면 카드 더미의 맨 위 카드를 공개해요.</p></article>
        <article><span>2</span><MousePointerClick /><h2>다섯을 찾아요.</h2><p>공개된 카드에서 같은 종류의 과일 합을 빠르게 계산해요.</p></article>
        <article><span>3</span><Bell /><h2>종을 울려요.</h2><p>같은 과일이 정확히 5개라면 가장 먼저 종을 누르세요.</p></article>
        <article><span>4</span><Trophy /><h2>카드를 모아요.</h2><p>정답이면 펼쳐진 카드를 모두 가져가요. 마지막까지 남으면 승리해요.</p></article>
      </section>
      <section className="rule-compare">
        <h2>종을 울려도 될까요?</h2>
        <div>
          <article className="correct-example"><header><Check /> 울려요</header><p>딸기 3개 + 딸기 2개</p><strong>정확히 5개</strong></article>
          <article className="wrong-example"><header><X /> 기다려요</header><p>라임 4개 + 라임 2개</p><strong>6개는 정답이 아니에요</strong></article>
        </div>
        <p className="penalty-note">잘못 울리면 다른 모든 플레이어에게 카드 한 장씩을 줘야 해요.</p>
      </section>
    </div>
  )
}
