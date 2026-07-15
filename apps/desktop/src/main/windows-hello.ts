import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync=promisify(execFile);
const ps=(body:string)=>['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',body];
// Windows PowerShell 5.1 no resuelve la sobrecarga genérica de AsTask sobre IAsyncOperation<T>;
// hay que localizar el método genérico por reflexión y cerrarlo con MakeGenericMethod.
const availabilityScript=`$null=[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]; Add-Type -AssemblyName System.Runtime.WindowsRuntime; $m=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'})[0]; $t=$m.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null,@([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync())); $t.Wait(); Write-Output $t.Result`;
// El diálogo de consentimiento se ancla a la ventana de la app vía IUserConsentVerifierInterop
// (si hay HWND); sin ventana padre Windows lo abre detrás de la app. El QI al interop se hace en
// C# porque el cast directo de PowerShell sobre System.__ComObject falla.
const verifyScript=`param([string]$WindowHandle='0',[string]$Message='Verifica tu identidad')
$ErrorActionPreference='Stop'
$null=[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$resultType=[Windows.Security.Credentials.UI.UserConsentVerificationResult]
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'})[0].MakeGenericMethod($resultType)
$operation=$null
$hwnd=[IntPtr]::Zero
if($WindowHandle -match '^[0-9]+$' -and $WindowHandle -ne '0'){$hwnd=[IntPtr][Int64]$WindowHandle}
if($hwnd -ne [IntPtr]::Zero){
  try{
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("39E050C3-4E74-441A-8DC0-B81104DF949C"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
public interface IUserConsentVerifierInterop
{
    [return: MarshalAs(UnmanagedType.IInspectable)]
    object RequestVerificationForWindowAsync(IntPtr appWindow, [MarshalAs(UnmanagedType.HString)] string message, [In] ref Guid riid);
}
public static class HelloInterop
{
    public static object Request(object factory, IntPtr hwnd, string message, Guid iid)
    {
        var interop = (IUserConsentVerifierInterop)factory;
        return interop.RequestVerificationForWindowAsync(hwnd, message, ref iid);
    }
}
'@
    $iid=$asTask.GetParameters()[0].ParameterType.GUID
    $factory=[System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeMarshal]::GetActivationFactory([Windows.Security.Credentials.UI.UserConsentVerifier])
    $operation=[HelloInterop]::Request($factory,$hwnd,$Message,$iid)
  }catch{$operation=$null}
}
if($null -eq $operation){$operation=[Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($Message)}
$task=$asTask.Invoke($null,@($operation))
$task.Wait()
Write-Output $task.Result
`;
let availabilityPromise:Promise<boolean>|undefined;
let verifyScriptPath:Promise<string>|undefined;
let windowHandleProvider:()=>string|undefined=()=>undefined;

/** The desktop shell registers how to obtain the HWND of the main window (as a decimal string). */
export function setWindowsHelloWindowProvider(provider:()=>string|undefined):void{windowHandleProvider=provider;}

function ensureVerifyScript():Promise<string>{
  if(!verifyScriptPath)verifyScriptPath=(async()=>{const file=join(tmpdir(),'escarlata-hello-verify.ps1');await writeFile(file,verifyScript,'utf8');return file;})();
  return verifyScriptPath;
}

/** Uses the Windows Runtime consent API, which invokes Windows Hello/PIN itself. */
export function windowsHelloAvailable():Promise<boolean>{
  if(!availabilityPromise)availabilityPromise=(async()=>{if(process.platform!=='win32')return false;try{const {stdout}=await execFileAsync('powershell.exe',ps(availabilityScript),{timeout:10_000,windowsHide:true});return stdout.trim()==='Available';}catch{availabilityPromise=undefined;return false;}})();
  return availabilityPromise;
}
export async function verifyWindowsHello():Promise<boolean>{
  if(!await windowsHelloAvailable())return false;
  try{
    const script=await ensureVerifyScript();
    const hwnd=windowHandleProvider()||'0';
    const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-WindowHandle',hwnd,'-Message','Desbloquear Escarlata'],{timeout:60_000,windowsHide:true});
    return stdout.trim()==='Verified';
  }catch{return false;}
}
