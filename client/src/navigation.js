// 视图切换。实现放在 views.js（它需要读当前下钻状态才知道「现在这个视图」是什么），
// 这里保留旧导出，免得各处 import 路径不一致。
export { switchView, currentView, currentList } from './views.js'
