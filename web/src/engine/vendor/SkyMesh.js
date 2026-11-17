import {
	BackSide,
	BoxGeometry,
	Mesh,
	Vector2,
	Vector3,
	NodeMaterial
} from 'three/webgpu';

import { Fn, float, floor, fract, vec2, vec3, acos, add, mul, clamp, cos, dot, exp, max, min, mix, modelViewProjection, normalize, positionWorld, pow, smoothstep, sub, varyingProperty, vec4, uniform, cameraPosition, time, If, Loop } from 'three/tsl';

class SkyMesh extends Mesh {

	constructor() {

		const material = new NodeMaterial();

		super( new BoxGeometry( 1, 1, 1 ), material );

		this.turbidity = uniform( 2 );

		this.rayleigh = uniform( 1 );

		this.mieCoefficient = uniform( 0.005 );

		this.mieDirectionalG = uniform( 0.8 );

		this.sunPosition = uniform( new Vector3() );

		this.cloudScale = uniform( 0.0002 );

		this.cloudSpeed = uniform( 0.00002 );

		this.cloudCoverage = uniform( 0.4 );

		this.cloudDensity = uniform( 0.4 );

		this.cloudElevation = uniform( 0.5 );

		this.showSunDisc = uniform( 1 );

		this.cloudOffset = uniform( new Vector2() );

		this.isSky = true;

		this.isSkyMesh = true;

		const vSunDirection = varyingProperty( 'vec3' );
		const vSunE = varyingProperty( 'float' );
		const vBetaR = varyingProperty( 'vec3' );
		const vBetaM = varyingProperty( 'vec3' );

		const vertexNode = Fn( () => {

			const e = float( 2.718281828459045 );

			const totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );

			const MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );

			const cutoffAngle = float( 1.6110731556870734 );
			const steepness = float( 1.5 );
			const EE = float( 1000.0 );

			const sunDirection = normalize( this.sunPosition );
			vSunDirection.assign( sunDirection );

			const angle = sunDirection.y;
			const zenithAngleCos = clamp( angle, - 1, 1 );
			const sunIntensity = EE.mul( max( 0.0, float( 1.0 ).sub( pow( e, cutoffAngle.sub( acos( zenithAngleCos ) ).div( steepness ).negate() ) ) ) );
			vSunE.assign( sunIntensity );

			const sunfade = float( 1.0 ).sub( clamp( float( 1.0 ).sub( exp( this.sunPosition.y.div( 450000.0 ) ) ), 0, 1 ) );

			const rayleighCoefficient = this.rayleigh.sub( float( 1.0 ).mul( float( 1.0 ).sub( sunfade ) ) );

			vBetaR.assign( totalRayleigh.mul( rayleighCoefficient ) );

			const c = float( 0.2 ).mul( this.turbidity ).mul( 10E-18 );
			const totalMie = float( 0.434 ).mul( c ).mul( MieConst );

			vBetaM.assign( totalMie.mul( this.mieCoefficient ) );

			const position = modelViewProjection;
			position.z.assign( position.w );

			return position;

		} )();

		const colorNode = Fn( () => {

			const pi = float( 3.141592653589793 );

			const rayleighZenithLength = float( 8.4E3 );
			const mieZenithLength = float( 1.25E3 );
			const sunAngularDiameterCos = float( 0.9999566769464484 );

			const THREE_OVER_SIXTEENPI = float( 0.05968310365946075 );
			const ONE_OVER_FOURPI = float( 0.07957747154594767 );

			const direction = normalize( positionWorld.sub( cameraPosition ) );

			const zenithAngle = acos( max( 0.0, direction.y ) );
			const inverse = float( 1.0 ).div( cos( zenithAngle ).add( float( 0.15 ).mul( pow( float( 93.885 ).sub( zenithAngle.mul( 180.0 ).div( pi ) ), - 1.253 ) ) ) );
			const sR = rayleighZenithLength.mul( inverse );
			const sM = mieZenithLength.mul( inverse );

			const Fex = exp( mul( vBetaR, sR ).add( mul( vBetaM, sM ) ).negate() );

			const cosTheta = dot( direction, vSunDirection );

			const c = cosTheta.mul( 0.5 ).add( 0.5 );
			const rPhase = THREE_OVER_SIXTEENPI.mul( float( 1.0 ).add( pow( c, 2.0 ) ) );
			const betaRTheta = vBetaR.mul( rPhase );

			const g2 = pow( this.mieDirectionalG, 2.0 );
			const inv = float( 1.0 ).div( pow( float( 1.0 ).sub( float( 2.0 ).mul( this.mieDirectionalG ).mul( cosTheta ) ).add( g2 ), 1.5 ) );
			const mPhase = ONE_OVER_FOURPI.mul( float( 1.0 ).sub( g2 ) ).mul( inv );
			const betaMTheta = vBetaM.mul( mPhase );

			const Lin = pow( vSunE.mul( add( betaRTheta, betaMTheta ).div( add( vBetaR, vBetaM ) ) ).mul( sub( 1.0, Fex ) ), vec3( 1.5 ) );
			Lin.mulAssign( mix( vec3( 1.0 ), pow( vSunE.mul( add( betaRTheta, betaMTheta ).div( add( vBetaR, vBetaM ) ) ).mul( Fex ), vec3( 1.0 / 2.0 ) ), clamp( pow( sub( 1.0, vSunDirection.y ), 5.0 ), 0.0, 1.0 ) ) );

			const L0 = vec3( 0.1 ).mul( Fex );

			const sundisc = clamp( cosTheta.sub( sunAngularDiameterCos ).mul( 50000.0 ), 0.0, 1.0 ).mul( this.showSunDisc );
			const sundiscColor = min( vSunE.mul( Fex ), 80.0 ).mul( 760.0 ).mul( sundisc );

			const texColor = add( Lin, L0 ).mul( 0.04 ).add( sundiscColor ).add( vec3( 0.0, 0.0003, 0.00075 ) ).toVar();

			const gradient = Fn( ( [ i ] ) => {

				const p = fract( i.xyx.mul( vec3( 0.1031, 0.1030, 0.0973 ) ) ).toVar();
				p.addAssign( dot( p, p.yzx.add( 33.33 ) ) );

				return fract( p.xx.add( p.yz ).mul( p.zy ) ).mul( 2.0 ).sub( 1.0 );

			} );

			const noise = Fn( ( [ p ] ) => {

				const i = floor( p );
				const f = fract( p );
				const u = f.mul( f ).mul( f ).mul( f.mul( f.mul( 6.0 ).sub( 15.0 ) ).add( 10.0 ) );

				const a = dot( gradient( i ), f );
				const b = dot( gradient( i.add( vec2( 1.0, 0.0 ) ) ), f.sub( vec2( 1.0, 0.0 ) ) );
				const c = dot( gradient( i.add( vec2( 0.0, 1.0 ) ) ), f.sub( vec2( 0.0, 1.0 ) ) );
				const d = dot( gradient( i.add( vec2( 1.0, 1.0 ) ) ), f.sub( vec2( 1.0, 1.0 ) ) );

				return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ).mul( 1.6 );

			} );

			const fbm = Fn( ( [ position, drift ] ) => {

				const p = vec2( position ).toVar();
				const result = float( 0.0 ).toVar();
				const amplitude = float( 1.0 ).toVar();

				Loop( 4, () => {

					result.addAssign( amplitude.mul( noise( p ) ) );
					amplitude.mulAssign( 0.5 );
					p.mulAssign( 2.0 ).addAssign( drift );

				} );

				return result;

			} );

			If( direction.y.greaterThan( 0.0 ).and( this.cloudCoverage.greaterThan( 0.0 ) ), () => {

				const elevation = mix( 1.0, 0.1, this.cloudElevation );
				const cloudUV = direction.xz.div( direction.y.mul( elevation ) ).toVar();
				cloudUV.mulAssign( this.cloudScale );
				cloudUV.addAssign( time.mul( this.cloudSpeed ) );
				cloudUV.addAssign( this.cloudOffset );

				const evolve = time.mul( this.cloudSpeed ).mul( 300.0 );
				const cloudNoise = fbm( cloudUV.mul( 1000.0 ), evolve ).mul( 0.7 ).add( 0.5 ).clamp( 0.0, 1.0 ).toVar();

				const region = noise( cloudUV.mul( 300.0 ) ).mul( 0.37 ).add( 0.5 );
				const cov = clamp( this.cloudCoverage.add( region.sub( 0.5 ).mul( 0.6 ) ), 0.0, 1.0 );

				const threshold = sub( 1.0, cov ).toVar();
				const cloudMask = smoothstep( threshold, threshold.add( 0.3 ), cloudNoise ).toVar();

				const horizonFade = smoothstep( 0.0, add( 0.03, mul( 0.06, this.cloudElevation ) ), direction.y );
				cloudMask.mulAssign( horizonFade );

				const dayFactor = smoothstep( - 0.08, 0.3, vSunDirection.y );
				const sunColor = vSunE.mul( Fex ).mul( 0.22 ).mul( 0.04 ).toVar();
				const skyAmbient = Lin.mul( 0.04 ).add( vec3( 0.0, 0.0003, 0.00075 ) );

				const depth = max( 0.0, cloudNoise.sub( threshold ) ).toVar();
				const beer = exp( depth.mul( - 4.0 ) ).toVar();
				const powder = sub( 1.0, beer.mul( beer ) );
				const shade = mix( 0.45, 1.0, beer.mul( powder ).mul( 2.6 ).clamp( 0.0, 1.0 ) );

				const silver = float( 0.51 ).div( pow( sub( 1.49, cosTheta.mul( 1.4 ) ), 1.5 ) ).clamp( 0.0, 3.0 );
				const edge = cloudMask.mul( sub( 1.0, cloudMask ) ).mul( 4.0 );

				const cloudColor = skyAmbient.add( sunColor.mul( shade ) ).toVar();
				cloudColor.addAssign( sunColor.mul( silver ).mul( edge ).mul( 0.6 ) );
				cloudColor.mulAssign( dayFactor.max( 0.03 ) );

				const alpha = sub( 1.0, exp( depth.mul( this.cloudDensity ).mul( - 12.0 ) ) ).mul( horizonFade ).toVar();

				texColor.subAssign( L0.mul( 0.04 ).add( sundiscColor ).mul( alpha ) );

				const cloudAerial = mix( texColor, cloudColor, Fex );
				texColor.assign( mix( texColor, cloudAerial, alpha ) );

			} );

			return vec4( texColor, 1.0 );

		} )();

		material.side = BackSide;
		material.depthWrite = false;
		material.fog = false;

		material.vertexNode = vertexNode;
		material.colorNode = colorNode;

	}

}

export { SkyMesh };
