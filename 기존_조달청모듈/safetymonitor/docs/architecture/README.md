# 관제웹 아키텍처 맵

`index.html` = 자립형 인터랙티브 다이어그램(브라우저로 바로 열면 된다). 기준 리비전 `272f5a9`.

정본은 `gwanje-web.architecture.json` 이고 HTML 은 거기서 생성한 산출물이다. 손으로 HTML 을 고치지 말 것.

재생성 (archify 스킬 · Node 18+, 설치 불필요)
```
node ~/.claude/skills/archify/bin/archify.mjs deliver architecture \
  gwanje-web.architecture.json index.html --quality showcase --repo-root <레포 루트>
```
`--repo-root` 는 노드의 `sources`(파일·줄 근거)를 검증하는 데 쓴다. 코드가 바뀌면 줄 번호와
`meta.repository.revision` 을 함께 갱신한다.
