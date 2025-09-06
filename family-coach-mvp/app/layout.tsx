import '../globals.css'
import TopNav from '../components/TopNav'
export const metadata={title:'HouseholdHQ',description:'Family wellness & planning'}
export default function RootLayout({children}:{children:React.ReactNode}){return (<html lang='en'><body><TopNav />{children}</body></html>)}
