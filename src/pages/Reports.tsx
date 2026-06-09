import React from 'react';
import { FileText, TrendingUp, BarChart3, PackageSearch, Users, Activity, Wallet, AlertCircle } from 'lucide-react';

export const Reports = () => {
  const accountReports = [
    { title: 'ميزان المراجعة', description: 'أرصدة الحسابات ومجاميعها المدخلة والمخرجة', icon: <Activity className="w-6 h-6" />, color: 'bg-indigo-50 text-indigo-700' },
    { title: 'قائمة الدخل (الأرباح والخسائر)', description: 'أداء الشركة المالي وتفاصيل الإيرادات والمصروفات', icon: <TrendingUp className="w-6 h-6" />, color: 'bg-emerald-50 text-emerald-700' },
    { title: 'المركز المالي (الميزانية العمومية)', description: 'المركز المالي للشركة ووضعها في نقطة زمنية', icon: <BarChart3 className="w-6 h-6" />, color: 'bg-blue-50 text-blue-700' },
    { title: 'كشف حساب', description: 'كشوفات حساب تفصيلية للعملاء، الموردين، والصناديق', icon: <FileText className="w-6 h-6" />, color: 'bg-slate-100 text-slate-700' },
    { title: 'كشف ضريبة القيمة المضافة', description: 'تقرير إقرارات الضريبة للفواتير الشرائية والبيعية', icon: <Wallet className="w-6 h-6" />, color: 'bg-amber-50 text-amber-700' },
  ];

  const inventoryReports = [
    { title: 'جرد المخزون', description: 'كميات وتكاليف البضائع في المستودعات', icon: <PackageSearch className="w-6 h-6" />, color: 'bg-purple-50 text-purple-700' },
    { title: 'حركة الأصناف', description: 'حركة الأصناف سحباً وإيداعاً، وأكثرها مبيعاً', icon: <Activity className="w-6 h-6" />, color: 'bg-cyan-50 text-cyan-700' },
    { title: 'نواقص المخزون', description: 'البضائع التي وصلت لحد الطلب أو نفدت', icon: <AlertCircle className="w-6 h-6" />, color: 'bg-rose-50 text-rose-700' },
  ];

  const hrReports = [
     { title: 'مسيرات الرواتب', description: 'تقارير تفصيلية لرواتب الموظفين والعمال', icon: <Users className="w-6 h-6" />, color: 'bg-teal-50 text-teal-700' },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">مركز التقارير</h2>
        <p className="text-slate-500 mt-1">عرض وتحليل التقارير المالية والإدارية الشاملة</p>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
            التقارير المالية والمحاسبية
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 shadow-sm lg:grid-cols-3 gap-4">
             {accountReports.map((report, idx) => (
                <div key={idx} className="bg-white p-5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition cursor-pointer group">
                   <div className={`w-12 h-12 rounded-lg ${report.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                     {report.icon}
                   </div>
                   <h4 className="font-bold text-slate-900 mb-2">{report.title}</h4>
                   <p className="text-sm text-slate-500 leading-relaxed">{report.description}</p>
                </div>
             ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <PackageSearch className="w-5 h-5 text-indigo-600" />
            تقارير المخزون
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 shadow-sm lg:grid-cols-3 gap-4">
             {inventoryReports.map((report, idx) => (
                <div key={idx} className="bg-white p-5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition cursor-pointer group">
                   <div className={`w-12 h-12 rounded-lg ${report.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                     {report.icon}
                   </div>
                   <h4 className="font-bold text-slate-900 mb-2">{report.title}</h4>
                   <p className="text-sm text-slate-500 leading-relaxed">{report.description}</p>
                </div>
             ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            تقارير الموارد البشرية
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 shadow-sm lg:grid-cols-3 gap-4">
             {hrReports.map((report, idx) => (
                <div key={idx} className="bg-white p-5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition cursor-pointer group">
                   <div className={`w-12 h-12 rounded-lg ${report.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                     {report.icon}
                   </div>
                   <h4 className="font-bold text-slate-900 mb-2">{report.title}</h4>
                   <p className="text-sm text-slate-500 leading-relaxed">{report.description}</p>
                </div>
             ))}
          </div>
        </div>
      </div>
    </div>
  );
};
