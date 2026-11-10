import {externalRewardDispatcher,externalRewardSecrets} from './external-reward-http';
import {externalRewardEndpoints,externalRewardHooks} from '@/custom/external-rewards';
export function externalRewardService(env:{EXTERNAL_REWARD_SECRETS?:string}){
 return externalRewardDispatcher({endpoints:externalRewardEndpoints,hooks:externalRewardHooks,secrets:externalRewardSecrets(env.EXTERNAL_REWARD_SECRETS)});
}
