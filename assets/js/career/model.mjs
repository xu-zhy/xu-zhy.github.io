export const schemas = {
  tasks: {title: '规划与任务', singular: '任务', statuses: ['未开始', '进行中', '已完成'], fields: [
    ['title','任务名称','text',true], ['level','层级',['阶段','月度','每周','每日']], ['phase','所属阶段'],
    ['category','分类'], ['priority','优先级',['P0','P1','P2']], ['start','开始日期','date'], ['due','截止日期','date'],
    ['status','状态',['未开始','进行中','已完成']], ['parent','父级任务'], ['notes','备注与完成标准','textarea']]},
  jobs: {title: '求职与面试', singular: '岗位', statuses: ['待研究','待投递','已投递','笔试','技术一面','技术二面','HR 面','Offer','已拒绝','已结束'], fields: [
    ['company','公司','text',true], ['title','岗位名称','text',true], ['city','城市'], ['category','技术方向'], ['url','岗位链接','url'],
    ['requirements','岗位与实习要求','textarea'], ['match','匹配程度',['高','中','低']], ['applied','投递日期','date'],
    ['status','当前状态',['待研究','待投递','已投递','笔试','技术一面','技术二面','HR 面','Offer','已拒绝','已结束']],
    ['action','下一步行动'], ['due','跟进日期','date'], ['result','最终结果与选择','textarea'], ['notes','自我评价与备注','textarea']]},
  knowledge: {title: '技术知识库', singular: '知识点', statuses: ['未学习','学习中','已掌握'], fields: [
    ['title','知识点名称','text',true], ['category','分类'], ['subcategory','子分类'], ['status','掌握程度',['未学习','学习中','已掌握']],
    ['resources','学习资料与链接','textarea'], ['notes','核心总结','textarea'], ['questions','面试问题','textarea'], ['project','关联项目'], ['due','下次复习','date']]}
};
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function inRange(record, range, today = localDate()) {
  const date = record.due;
  if (range === 'all') return true;
  if (!date) return false;
  if (range === 'today') return date === today;
  if (range === 'future') return date > today;
  if (range === 'overdue') return date < today && !['已完成','已掌握','已拒绝','已结束','Offer'].includes(record.status);
  const now = new Date(`${today}T12:00:00`);
  const start = new Date(now); start.setDate(now.getDate() - (now.getDay() + 6) % 7);
  const end = new Date(start); end.setDate(start.getDate()+6);
  return date >= localDate(start) && date <= localDate(end);
}
export function filtered(records, query, status, range) {
  const term = query.toLocaleLowerCase().trim();
  return records.filter(r => (!term || Object.values(r).some(v => String(v).toLocaleLowerCase().includes(term))) &&
    (!status || r.status === status) && inRange(r, range)).sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.priority || '').localeCompare(b.priority || ''));
}
export function validateTask(record, tasks) {
  if (record.start && record.due && record.start > record.due) throw new Error('截止日期不能早于开始日期。');
  let id = record.parent;
  const seen = new Set([record.id]);
  while (id) {
    if (seen.has(id)) throw new Error('父级任务不能形成循环。');
    seen.add(id);
    const parent = tasks.find(t => t.id === id);
    if (!parent) throw new Error('父级任务不存在。');
    id = parent.parent;
  }
}
