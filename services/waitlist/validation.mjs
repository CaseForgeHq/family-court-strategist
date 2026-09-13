export const CONSENT='desktop-launch-v1';
export function validateSignup(data){
 if(!data||typeof data!=='object'||Array.isArray(data))return {error:'Check the form and try again.'};
 if(data.company)return {error:'The form could not be submitted.'};
 const name=typeof data.name==='string'?data.name.trim():'';
 const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
 const platform=data.platform||'not-sure';
 if(!name||name.length>100||/[\x00-\x1f\x7f]/.test(name))return {error:'Enter your name (up to 100 characters).'};
 if(email.length>254||!/^\S+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))return {error:'Enter a valid email address.'};
 if(!['mac','windows','linux','not-sure'].includes(platform))return {error:'Choose a computer type.'};
 if(data.consent!==true)return {error:'Confirm that you want a desktop app launch update.'};
 return {name,email,platform};
}
