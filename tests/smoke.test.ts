// 脚手架冒烟测试：确认 vitest 管线可用（后续被真实测试替代）
describe('scaffold', () => {
  it('vitest 运行正常', () => {
    expect(1 + 1).toBe(2);
  });
});
